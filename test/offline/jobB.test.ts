// Job B offline checks: a decision from the chat goes to the owner desk with a suggested owner and
// date; only the owner's text reply confirms it (a non-owner "confirm" is ignored); the team then
// sees one short line in the thread; pending confirms survive a restart (R6).
import { beforeEach, describe, expect, it } from 'vitest';
import { handleOwnerDesk } from '../../src/agent/owner-desk.ts';
import { PendingStore } from '../../src/agent/pending.ts';
import { decide } from '../../src/agent/pipeline.ts';
import { AgentState } from '../../src/agent/state.ts';
import { FakeClaude, verdictMessage } from '../fake-claude.ts';
import { ctx, details, FakePoster, jobItem, KASH, msg, OPUS, ownerReadingMessage, PRIYA, SAM, SELF, setup } from './jobs-fixture.ts';

let t: ReturnType<typeof setup>;
beforeEach(() => { t = setup('ck-jobB-'); });

const decision = (id = 'm1') => verdictMessage(OPUS, ctx, [jobItem(id, {
  job: 'B', verdict: 'decision',
  details: details({ summary: 'Fieldnote goes first for onboarding.', why: 'They signed first.', date: '2026-11-24', suggested_owner: 'Priya', owner_basis: 'Priya: onboarding calls and pilot support.' }),
})], [{ blockId: 'pilot-plan.md §3.1' }]);

async function proposeFromPriya(poster: FakePoster) {
  const claude = new FakeClaude([{ model: OPUS, respond: decision() }]);
  await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'Ok, Fieldnote goes first for onboarding, Tue 24th.', PRIYA, 'Priya')]);
  claude.done();
}

describe('job B: the note in the owner desk', () => {
  it('a decision agreed by a teammate goes to the owner desk with what, why, source, date and a suggested owner; nothing public yet', async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    expect(poster.pub()).toEqual([]);
    expect(poster.desk()).toHaveLength(1);
    const note = poster.desk()[0].body;
    expect(note).toContain('#1 · Decision to confirm in ck-test');
    expect(note).toContain('Agreed: Fieldnote goes first for onboarding.');
    expect(note).toContain('Why: They signed first.');
    expect(note).toContain('Priya, m1');
    expect(note).toContain('Date: Tue 24 Nov');
    expect(note).toMatch(/1\. Suggested owner: Priya \(Priya: onboarding calls and pilot support\.\)/);
    expect(note).toMatch(/2\. Or tell me/);
    const [line] = t.traces();
    expect(line.kind).toBe('owner_note');
    expect(line.items[0]).toMatchObject({ job: 'B', verdict: 'decision', decision_record: { summary: 'Fieldnote goes first for onboarding.', owner: 'Priya', date: '2026-11-24' } });
    expect(new PendingStore(t.pendingFile).open()).toHaveLength(1);
  });

  it('with no owner in the record, the note says so instead of guessing', async () => {
    const poster = new FakePoster();
    const claude = new FakeClaude([{ model: OPUS, respond: verdictMessage(OPUS, ctx, [jobItem('m1', { job: 'B', verdict: 'decision', details: details({ summary: 'Weekly demo on Fridays.' }) })], []) }]);
    await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'Agreed, weekly demo on Fridays then.', SAM, 'Sam')]);
    expect(poster.desk()[0].body).toContain('No owner suggested');
    expect(poster.desk()[0].body).toContain('Date: none given');
  });
});

describe('job B: the confirm (owner only, text reply)', () => {
  it("a non-owner's 'confirm' in the desk is ignored: nothing posted, the item stays open", async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    const d = t.deps(new FakeClaude([]), poster);
    const line = await handleOwnerDesk(d, 'desk', 'ck-owner-desk', msg('o1', 'confirm', SAM, 'Sam', { thread_id: 'ev1' }));
    expect(line?.kind).toBe('silence');
    expect(line?.error).toMatch(/not the owner/);
    expect(poster.pub()).toEqual([]);
    expect(d.pending!.open()).toHaveLength(1);
  });

  it("our own post in the desk is never read as a reply", async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    expect(await handleOwnerDesk(t.deps(new FakeClaude([]), poster), 'desk', 'ck-owner-desk', msg('o1', 'confirm', SELF, 'Context Keeper'))).toBeNull();
  });

  it("the owner's 'confirm' posts one short line in the original thread, with the suggested owner and date", async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    const d = t.deps(new FakeClaude([]), poster); // a plain confirm needs no model call
    const line = await handleOwnerDesk(d, 'desk', 'ck-owner-desk', msg('o1', 'confirm', KASH, 'Kash', { thread_id: 'ev1' }));
    expect(poster.pub()).toHaveLength(1);
    expect(poster.pub()[0]).toMatchObject({ room: 'room1', thread: 'm1' });
    expect(poster.pub()[0].body).toBe("Logged as decided: Fieldnote goes first for onboarding. Owner: Priya. Date: Tue 24 Nov. (Kash's call.)");
    expect(line?.kind).toBe('reply');
    expect(line?.items[0].decision_record).toEqual({ summary: 'Fieldnote goes first for onboarding.', owner: 'Priya', date: '2026-11-24' });
    expect(d.pending!.open()).toEqual([]);
    expect(d.pending!.decisions('room1')).toHaveLength(1);
    // The same reply seen again (a redelivery) does nothing.
    expect(await handleOwnerDesk(d, 'desk', 'ck-owner-desk', msg('o1', 'confirm', KASH, 'Kash', { thread_id: 'ev1' }))).toBeNull();
    expect(poster.pub()).toHaveLength(1);
  });

  it("'owner Sam' confirms with a different owner, read by code", async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    await handleOwnerDesk(t.deps(new FakeClaude([]), poster), 'desk', 'ck-owner-desk', msg('o1', '#1 owner Sam', KASH, 'Kash'));
    expect(poster.pub()[0].body).toContain('Owner: Sam.');
  });

  it("a free-text correction is read by one model call; the public line is built from its fields, not the owner's words", async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    const reading = ownerReadingMessage({ action: 'confirm', summary: 'Harbour & Pine goes first for onboarding.', owner: 'Priya', date: '2026-11-25' });
    const claude = new FakeClaude([{ model: OPUS, respond: reading }]);
    const ownerText = 'hmm no, actually H&P first, wed - fieldnote asked to slip (keep this between us)';
    await handleOwnerDesk(t.deps(claude, poster), 'desk', 'ck-owner-desk', msg('o1', ownerText, KASH, 'Kash', { thread_id: 'ev1' }));
    claude.done();
    expect(poster.pub()[0].body).toBe("Logged as decided: Harbour & Pine goes first for onboarding. Owner: Priya. Date: Wed 25 Nov. (Kash's call.)");
    expect(poster.pub()[0].body).not.toContain('between us');
  });

  it("'drop' closes the item with nothing posted", async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    const d = t.deps(new FakeClaude([]), poster);
    await handleOwnerDesk(d, 'desk', 'ck-owner-desk', msg('o1', 'drop', KASH, 'Kash', { thread_id: 'ev1' }));
    expect(poster.pub()).toEqual([]);
    expect(d.pending!.all()[0].status).toBe('dropped');
  });

  it('with two open items and no number, it asks which one, privately', async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    const claude = new FakeClaude([{ model: OPUS, respond: decision('m2') }]);
    await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m2', 'Agreed: weekly demo on Fridays.', SAM, 'Sam')]);
    await handleOwnerDesk(t.deps(new FakeClaude([]), poster), 'desk', 'ck-owner-desk', msg('o1', 'confirm', KASH, 'Kash'));
    expect(poster.pub()).toEqual([]);
    expect(poster.desk().at(-1)!.body).toMatch(/^Which one\? Open: #1 .*#2 /);
  });
});

describe('job B: the line', () => {
  it("doesn't repeat a date the summary already gives", async () => {
    const { loggedLine } = await import('../../src/agent/jobs/decision.ts');
    expect(loggedLine({ summary: 'Fieldnote goes first, on Tue 24 Nov 2026', owner: '', date: '2026-11-24', confirmedBy: 'Kash' }))
      .toBe("Logged as decided: Fieldnote goes first, on Tue 24 Nov 2026. (Kash's call.)");
  });
});

describe('job B: the owner states it himself (T14)', () => {
  it("the owner's own message is the confirmation: one short line now, no desk note, decision_record owner Kash", async () => {
    const poster = new FakePoster();
    const claude = new FakeClaude([{ model: OPUS, respond: decision() }]);
    const d = t.deps(claude, poster);
    await decide(d, 'room1', 'ck-test', ctx, [msg('m1', 'Ok, Fieldnote goes first for onboarding, Tue 24th.', KASH, 'Kash')]);
    claude.done();
    expect(poster.desk()).toEqual([]);
    expect(poster.pub()).toHaveLength(1);
    expect(poster.pub()[0]).toMatchObject({ thread: 'm1', body: "Logged as decided: Fieldnote goes first for onboarding. Date: Tue 24 Nov. (Kash's call.)" });
    const [line] = t.traces();
    expect(line.items[0].decision_record).toEqual({ summary: 'Fieldnote goes first for onboarding.', owner: 'Kash', date: '2026-11-24' });
    expect(d.pending!.decisions()).toHaveLength(1);
    expect(d.pending!.open()).toEqual([]);
  });
});

describe('R6 restart safety for pending confirms', () => {
  it('a pending confirm survives a restart: new state objects from the same files still find it, and the confirm posts once', async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    // "Restart": nothing in memory carries over; only the files in state/ do.
    const pending = new PendingStore(t.pendingFile);
    expect(pending.open()).toHaveLength(1);
    expect(pending.open()[0]).toMatchObject({ n: 1, kind: 'B', thread_id: 'm1', note_event_id: 'ev1', raised_by: 'Priya' });
    const after = t.deps(new FakeClaude([]), poster, { pending, state: new AgentState(t.stateFile) });
    await handleOwnerDesk(after, 'desk', 'ck-owner-desk', msg('o1', 'yes', KASH, 'Kash', { thread_id: 'ev1' }));
    expect(poster.pub()).toHaveLength(1);
    expect(new PendingStore(t.pendingFile).open()).toEqual([]);
    // A second restart doesn't bring it back or post again.
    const again = t.deps(new FakeClaude([]), poster);
    expect(await handleOwnerDesk(again, 'desk', 'ck-owner-desk', msg('o1', 'yes', KASH, 'Kash', { thread_id: 'ev1' }))).toBeNull();
    expect(poster.pub()).toHaveLength(1);
  });

  it('a retried decision never doubles the pending item or the desk note', async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    const claude = new FakeClaude([{ model: OPUS, respond: decision() }]);
    // Same message again, as if the first attempt's processed mark was lost.
    await decide(t.deps(claude, poster, { state: new AgentState(null) }), 'room1', 'ck-test', ctx, [msg('m1', 'Ok, Fieldnote goes first for onboarding, Tue 24th.', PRIYA, 'Priya')]);
    expect(new PendingStore(t.pendingFile).all()).toHaveLength(1);
    expect(poster.desk()).toHaveLength(1);
  });
});
