// Memory offline checks, against a fake Switch: the record the agent cites comes from the room's
// documents (list_references + load_internal_documents, the Channel archive among them) and its
// history (read_context), not from demo/; it is the same record, block for block, as the demo files
// the seed writes into the room, so refs ("product.md §2", "led-011") and the quote gate are
// unchanged. It refreshes when documents change. Job B writes the agent's own "Decision log" room
// document (create once, update after), which job A then cites like any decision row.
import { beforeEach, describe, expect, it } from 'vitest';
import { demoContent } from '../../seed/content.ts';
import { buildRoomContext } from '../../src/agent/blocks.ts';
import { parseLog, renderLog } from '../../src/agent/decision-log.ts';
import { RoomMemory } from '../../src/agent/memory.ts';
import { handleOwnerDesk } from '../../src/agent/owner-desk.ts';
import { decide } from '../../src/agent/pipeline.ts';
import { gateSources } from '../../src/agent/post.ts';
import { loadDemoRoom } from '../../src/agent/room.ts';
import { quoteVerified } from '../../src/shared/quote.ts';
import { FakeClaude, verdictMessage } from '../fake-claude.ts';
import { FakeSwitch } from './fake-switch.ts';
import { ctx, details, FakePoster, jobItem, KASH, msg, OPUS, PRIYA, room as fixtureRoom, setup } from './jobs-fixture.ts';

const AGENT = 'agent-ck';
const NAME = 'context-keeper-eval';
const ROOM = 'room1';

/** A room seeded the way `npm run seed` seeds it: every seed document, created by the agent. */
function seeded(sw: FakeSwitch, demo: 'ledgerly' | 'riverside', room = ROOM) {
  for (const d of demoContent(demo).docs) sw.addDoc(room, { name: d.name, description: d.description, content: d.content });
  for (const d of demoContent(demo).docs) sw.post(room, { sender: sw.agentSender, sender_name: NAME, body: `📄 created room document “${d.name}”.`, timestamp: 1_000 });
}

function memoryOn(sw: FakeSwitch, over: Partial<ConstructorParameters<typeof RoomMemory>[0]> = {}) {
  const logs: string[] = [];
  const m = new RoomMemory({ op: sw.opFor(), agentId: AGENT, selfNames: () => new Set([NAME]), selfSenders: new Set(), log: (s) => logs.push(s), ...over });
  return { m, logs };
}

let sw: FakeSwitch;
beforeEach(() => { sw = new FakeSwitch(AGENT, NAME); });

describe('memory: the record comes from Switch', () => {
  for (const [demo, roomName] of [['ledgerly', 'ledgerly-pilot'], ['riverside', 'riverside-build-night']] as const) {
    it(`${demo}: the same docs, messages and citation blocks as the demo files the seed wrote`, async () => {
      seeded(sw, demo);
      const { m } = memoryOn(sw);
      const rec = await m.record(ROOM, 'ck-eval-x');
      const want = loadDemoRoom('.', roomName);
      expect(rec!.docs).toEqual(want.docs); // same files, same order (the archive's own docs: list), same bytes
      expect(rec!.messages).toEqual(want.messages);
      const a = buildRoomContext(rec!);
      const b = buildRoomContext({ ...want, name: 'ck-eval-x' });
      expect(JSON.stringify(a.documents)).toBe(JSON.stringify(b.documents)); // byte-identical prompt: the cache prefix holds
      expect([...a.sourceText.entries()]).toEqual([...b.sourceText.entries()]);
      expect(sw.calls.map((c) => c.name)).toEqual(['list_references', 'load_internal_documents', 'read_context']);
    });
  }

  it('room history: people\'s messages (and thread replies) join the record; our own posts, joins and Switch\'s document notices do not', async () => {
    seeded(sw, 'ledgerly');
    sw.post(ROOM, { kind: 'room_join', sender: '@switch-admin:localhost', sender_name: 'admin', body: 'admin joined the room', timestamp: 900 });
    sw.post(ROOM, { sender: sw.agentSender, sender_name: NAME, body: "Hey! Ping @context-keeper-eval and I'll jump in.", timestamp: 950 });
    const root = sw.post(ROOM, { sender: '@mm-rowan:localhost', sender_name: 'rowan', body: 'Should we offer weekend onboarding?', timestamp: Date.parse('2026-11-04T10:00:00Z') });
    sw.post(ROOM, { sender: '@mm-priya:localhost', sender_name: 'priya', body: 'See D1.', timestamp: Date.parse('2026-11-04T10:01:00Z'), thread: root });
    const { m } = memoryOn(sw, { displayName: async (_s, h) => h[0].toUpperCase() + h.slice(1) });
    const rec = (await m.record(ROOM, 'ck-eval-x'))!;
    const live = rec.messages.filter((x) => !x.id.startsWith('led-'));
    expect(live).toEqual([
      { id: root, at: '2026-11-04T10:00:00.000Z', author: 'Rowan', text: 'Should we offer weekend onboarding?', thread: null },
      { id: expect.any(String), at: '2026-11-04T10:01:00.000Z', author: 'Priya', text: 'See D1.', thread: root },
    ]);
    // A live message the stream then delivers again is not doubled.
    m.addLive(ROOM, live[0]);
    expect(rec.messages.filter((x) => x.id === root)).toHaveLength(1);
  });

  it('a room with no documents has no record (the agent skips it, as before)', async () => {
    const { m } = memoryOn(sw);
    expect(await m.record('empty', 'ck-eval-empty')).toBeNull();
  });

  it('refresh: one list_references call when nothing changed; a new document is fetched, a removed one dropped', async () => {
    seeded(sw, 'ledgerly');
    const { m } = memoryOn(sw);
    const rec = (await m.record(ROOM, 'ck-eval-x'))!;
    sw.calls = [];
    await m.refresh(ROOM);
    expect(sw.calls.map((c) => c.name)).toEqual(['list_references']);
    const added = sw.addDoc(ROOM, { name: 'Launch checklist', content: '# Launch checklist\n\nLast updated Wed 4 Nov 2026\n\n## §1 Before launch\n- Stripe live keys in.\n' }, 'claude-code');
    await m.refresh(ROOM);
    expect(rec.docs.map((d) => d.file)).toEqual(['product.md', 'pilot-plan.md', 'roadmap.md', 'status.md', 'research.md', 'launch-checklist.md']);
    expect(buildRoomContext(rec).sourceText.get('launch-checklist.md §1')).toContain('Stripe live keys in.');
    expect(rec.messages.filter((x) => x.id.startsWith('led-')).length).toBeGreaterThan(20); // the archive is kept
    sw.docs.set(ROOM, sw.docs.get(ROOM)!.filter((d) => d.id !== added));
    await m.refresh(ROOM);
    expect(rec.docs.map((d) => d.file)).not.toContain('launch-checklist.md');
  });

  it('a Switch error while refreshing keeps the last record (fail soft)', async () => {
    seeded(sw, 'ledgerly');
    const { m, logs } = memoryOn(sw);
    const rec = (await m.record(ROOM, 'ck-eval-x'))!;
    const before = JSON.stringify(rec);
    sw.failNext = 'list_references';
    await m.refresh(ROOM);
    expect(JSON.stringify(rec)).toBe(before);
    expect(logs.at(-1)).toMatch(/refreshing .* failed, keeping the last record/);
  });

  it('after a stream gap, read_context adds the messages that were missed', async () => {
    seeded(sw, 'ledgerly');
    const { m } = memoryOn(sw);
    const rec = (await m.record(ROOM, 'ck-eval-x'))!;
    const id = sw.post(ROOM, { sender: '@mm-sam:localhost', sender_name: 'sam', body: 'Posted while the stream was down.', timestamp: Date.parse('2026-11-04T11:00:00Z') });
    expect(await m.rereadHistory(ROOM)).toBe(1);
    expect(rec.messages.at(-1)).toMatchObject({ id, text: 'Posted while the stream was down.' });
    expect(await m.rereadHistory(ROOM)).toBe(0);
  });
});

const decided = (over: Partial<{ summary: string; action_owner: string | null; due: string | null; reopen_if: string | null }> = {}) => ({
  summary: 'Fieldnote goes first for onboarding.', decided_by: 'Kash', action_owner: null, due: '2026-11-24', reopen_if: null, date: '2026-11-04', ...over,
});

describe('memory: the Decision log is a room document the agent owns', () => {
  it('first decision: create_room_document once; the next: update_room_document; the record is read back from Switch', async () => {
    seeded(sw, 'ledgerly');
    const { m } = memoryOn(sw);
    const rec = (await m.record(ROOM, 'ck-eval-x'))!;
    sw.calls = [];
    expect(await m.logDecision({ roomId: ROOM, roomName: 'ck-eval-x', record: decided(), why: 'They signed first.', sourceMessageId: 'sw_m14', raisedBy: 'Kash' })).toBe('decision log: L1 added (create_room_document)');
    expect(sw.calls.map((c) => c.name)).toEqual(['create_room_document', 'load_internal_documents']);
    const log = sw.docs.get(ROOM)!.find((d) => d.name === 'Decision log')!;
    expect(log.created_by_agent_id).toBe(AGENT);
    expect(rec.docs.at(-1)!.file).toBe('decision-log.md');
    expect(rec.docs.at(-1)!.text).toBe(log.content);

    sw.calls = [];
    expect(await m.logDecision({ roomId: ROOM, roomName: 'ck-eval-x', record: decided({ summary: 'Weekly demo on Fridays.', due: null }), why: '', sourceMessageId: 'sw_m20', raisedBy: 'Sam' })).toBe('decision log: L2 added (update_room_document)');
    expect(sw.calls.map((c) => c.name)).toEqual(['update_room_document', 'load_internal_documents']);
    expect(parseLog(log.content).map((e) => [e.id, e.decision, e.raised_by])).toEqual([['L1', 'Fieldnote goes first for onboarding', 'Kash'], ['L2', 'Weekly demo on Fridays', 'Sam']]);
    // Each write is visible in the room as Switch's own notice (the scorer counts these apart).
    expect((sw.history.get(ROOM) ?? []).map((e) => e.body).filter((b) => b.includes('Decision log'))).toEqual(['📄 created room document “Decision log”.', '📄 updated room document “Decision log”.']);
  });

  it('the owner filling in the action owner updates the same entry; saying it again writes nothing', async () => {
    seeded(sw, 'ledgerly');
    const { m } = memoryOn(sw);
    await m.record(ROOM, 'ck-eval-x');
    await m.logDecision({ roomId: ROOM, roomName: 'ck-eval-x', record: decided(), why: 'They signed first.', sourceMessageId: 'sw_m14', raisedBy: 'Kash' });
    expect(await m.logDecision({ roomId: ROOM, roomName: 'ck-eval-x', record: decided({ action_owner: 'Priya' }), why: '', sourceMessageId: 'sw_m14', raisedBy: 'Kash' })).toBe('decision log: L1 updated (update_room_document)');
    sw.calls = [];
    expect(await m.logDecision({ roomId: ROOM, roomName: 'ck-eval-x', record: decided({ action_owner: 'Priya' }), why: '', sourceMessageId: 'sw_m14', raisedBy: 'Kash' })).toBe('decision log: L1 already says this; not written');
    expect(sw.calls).toEqual([]);
    const [e] = m.decisionLog(ROOM);
    expect(e).toMatchObject({ id: 'L1', action_owner: 'Priya', why: 'They signed first.', due: '2026-11-24', decided_by: 'Kash' });
  });

  it('job A cites a logged decision like any decision row: block "decision-log.md §1 L1", the quote verified against what Switch holds', async () => {
    seeded(sw, 'ledgerly');
    const { m } = memoryOn(sw);
    const rec = (await m.record(ROOM, 'ck-eval-x'))!;
    await m.logDecision({ roomId: ROOM, roomName: 'ck-eval-x', record: decided({ reopen_if: 'Fieldnote can\'t make the 24th' }), why: 'They signed first.', sourceMessageId: 'sw_m14', raisedBy: 'Kash' });
    const c = buildRoomContext(rec);
    const block = c.table.flat().find((b) => b.blockId === 'decision-log.md §1 L1')!;
    expect(block).toMatchObject({ ref: 'decision-log.md §1', kind: 'row', author: 'Kash', at: '2026-11-04', display: 'Fieldnote goes first for onboarding: They signed first.' });
    const { verified } = gateSources([{ block, citedText: block.text }], c);
    expect(verified).toHaveLength(1);
    expect(verified[0].who).toBe('Kash, 4 Nov (decision-log.md §1 L1)');
    expect(quoteVerified('Fieldnote goes first for onboarding', c.sourceText.get('decision-log.md §1')!)).toBe(true);
    const { reopenIf } = await import('../../src/agent/jobs/reopen.ts');
    expect(reopenIf(block)).toBe("Fieldnote can't make the 24th");
  });

  it('cache: the Decision log has its own breakpoint after the stable docs; the archive keeps its own (3 in all)', async () => {
    seeded(sw, 'ledgerly');
    const { m } = memoryOn(sw);
    const rec = (await m.record(ROOM, 'ck-eval-x'))!;
    const before = buildRoomContext(rec).documents.map((d) => [d.title, !!d.cache_control]);
    expect(before.filter(([, c]) => c)).toEqual([['research.md', true], ['Channel archive', true]]);
    await m.logDecision({ roomId: ROOM, roomName: 'ck-eval-x', record: decided(), why: '', sourceMessageId: 'sw_m14', raisedBy: 'Kash' });
    const after = buildRoomContext(rec).documents;
    expect(after.map((d) => d.title)).toEqual(['product.md', 'pilot-plan.md', 'roadmap.md', 'status.md', 'research.md', 'decision-log.md', 'Channel archive']);
    expect(after.filter((d) => d.cache_control).map((d) => d.title)).toEqual(['research.md', 'decision-log.md', 'Channel archive']);
    // The docs before the log are byte-identical to before it existed: they stay a cache hit.
    expect(JSON.stringify(after.slice(0, 5))).toBe(JSON.stringify(buildRoomContext({ ...rec, docs: rec.docs.slice(0, 5) }).documents.slice(0, 5)));
  });

  it('after a restart the agent finds its log by name and carries on (L2, no second create)', async () => {
    seeded(sw, 'ledgerly');
    const first = memoryOn(sw).m;
    await first.record(ROOM, 'ck-eval-x');
    await first.logDecision({ roomId: ROOM, roomName: 'ck-eval-x', record: decided(), why: '', sourceMessageId: 'sw_m14', raisedBy: 'Kash' });
    const again = memoryOn(sw).m;
    const rec = (await again.record(ROOM, 'ck-eval-x'))!;
    expect(again.decisionLog(ROOM).map((e) => e.id)).toEqual(['L1']);
    expect(rec.docs.at(-1)!.file).toBe('decision-log.md');
    sw.calls = [];
    expect(await again.logDecision({ roomId: ROOM, roomName: 'ck-eval-x', record: decided({ summary: 'Weekly demo on Fridays.' }), why: '', sourceMessageId: 'sw_m20', raisedBy: 'Sam' })).toBe('decision log: L2 added (update_room_document)');
    expect(sw.docs.get(ROOM)!.filter((d) => d.name.startsWith('Decision log'))).toHaveLength(1);
  });

  it("someone else's \"Decision log\" can't be edited: ours is \"Decision log (v2)\", and both are in the record", async () => {
    seeded(sw, 'ledgerly');
    sw.addDoc(ROOM, { name: 'Decision log', content: renderLog('old', [], new Date(0)) }, 'old-agent');
    const { m } = memoryOn(sw);
    const rec = (await m.record(ROOM, 'ck-eval-x'))!;
    await m.logDecision({ roomId: ROOM, roomName: 'ck-eval-x', record: decided(), why: '', sourceMessageId: 'sw_m14', raisedBy: 'Kash' });
    expect(sw.docs.get(ROOM)!.map((d) => d.name).filter((n) => n.startsWith('Decision log'))).toEqual(['Decision log', 'Decision log (v2)']);
    expect(rec.docs.map((d) => d.file).slice(-2)).toEqual(['decision-log-2.md', 'decision-log.md']);
  });

  it('a room outside CK_POST_ROOMS is dry-run: nothing is written to Switch', async () => {
    seeded(sw, 'ledgerly');
    const { m, logs } = memoryOn(sw, { canWrite: () => false });
    await m.record(ROOM, 'ledgerly-pilot');
    sw.calls = [];
    expect(await m.logDecision({ roomId: ROOM, roomName: 'ledgerly-pilot', record: decided(), why: '', sourceMessageId: 'sw_m14', raisedBy: 'Kash' })).toBe('decision log: dry-run, L1 not written');
    expect(sw.calls).toEqual([]);
    expect(logs.at(-1)).toMatch(/^\[dry-run: ledgerly-pilot not writable\] would add L1/);
  });
});

describe('memory: job B writes the Decision log through the pipeline and the owner desk', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => { t = setup('ck-memory-'); });

  it('the owner states a decision (T14): logged in the thread and in the Decision log; "owner Sam" in the desk updates the entry', async () => {
    sw.addDoc(ROOM, { name: 'Ledgerly pilot plan', description: 'x (seeded project document, pilot-plan.md)', content: fixtureRoom.docs[0].text });
    const { m } = memoryOn(sw);
    const rec = (await m.record(ROOM, 'ck-test'))!;
    const poster = new FakePoster();
    const claude = new FakeClaude([{ model: OPUS, respond: verdictMessage(OPUS, ctx, [jobItem('m1', {
      job: 'B', verdict: 'decision',
      details: details({ summary: 'Fieldnote goes first for onboarding.', why: 'They signed first.', date: '2026-11-24', suggested_owner: 'Priya', owner_basis: 'Priya: onboarding calls and pilot support.' }),
    })], [{ blockId: 'pilot-plan.md §3.1' }]) }]);
    const d = t.deps(claude, poster, { onDecisionLogged: (x) => m.logDecision(x) });
    await decide(d, ROOM, 'ck-test', buildRoomContext(rec), [msg('m1', 'Ok, Fieldnote goes first for onboarding, Tue 24th.', KASH, 'Kash')]);
    claude.done();
    expect(t.traces()[0].error).toContain('decision log: L1 added (create_room_document)');
    expect(m.decisionLog(ROOM)).toEqual([expect.objectContaining({ id: 'L1', decision: 'Fieldnote goes first for onboarding', decided_by: 'Kash', action_owner: '', due: '2026-11-24', source: 'm1', raised_by: 'Kash' })]);

    await handleOwnerDesk(t.deps(new FakeClaude([]), poster, { onDecisionLogged: (x) => m.logDecision(x) }), 'desk', 'ck-owner-desk', msg('o1', '#1 owner Sam', KASH, 'Kash'));
    expect(t.traces().at(-1)!.error).toContain('decision log: L1 updated (update_room_document)');
    expect(m.decisionLog(ROOM)[0]).toMatchObject({ id: 'L1', action_owner: 'Sam' });
    expect(buildRoomContext(rec).sourceText.get('decision-log.md §1')).toContain('| L1 | confirmed | Fieldnote goes first for onboarding | They signed first. | Kash | 2026-11-04 | Sam | 2026-11-24 |');
  });

  it("a teammate's decision is written only once the owner confirms it", async () => {
    sw.addDoc(ROOM, { name: 'Ledgerly pilot plan', description: 'x (seeded project document, pilot-plan.md)', content: fixtureRoom.docs[0].text });
    const { m } = memoryOn(sw);
    const rec = (await m.record(ROOM, 'ck-test'))!;
    const poster = new FakePoster();
    const claude = new FakeClaude([{ model: OPUS, respond: verdictMessage(OPUS, ctx, [jobItem('m1', { job: 'B', verdict: 'decision', details: details({ summary: 'Weekly demo on Fridays.' }) })], []) }]);
    await decide(t.deps(claude, poster, { onDecisionLogged: (x) => m.logDecision(x) }), ROOM, 'ck-test', buildRoomContext(rec), [msg('m1', 'Agreed, weekly demo on Fridays then.', PRIYA, 'Priya')]);
    expect(m.decisionLog(ROOM)).toEqual([]);
    expect(sw.docs.get(ROOM)!.some((d) => d.name === 'Decision log')).toBe(false);
    await handleOwnerDesk(t.deps(new FakeClaude([]), poster, { onDecisionLogged: (x) => m.logDecision(x) }), 'desk', 'ck-owner-desk', msg('o1', 'confirm', KASH, 'Kash', { thread_id: poster.desk()[0] ? 'ev1' : null }));
    expect(m.decisionLog(ROOM)).toEqual([expect.objectContaining({ id: 'L1', decision: 'Weekly demo on Fridays', decided_by: 'Kash', raised_by: 'Priya' })]);
  });
});
