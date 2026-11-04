// Reply speed (Kash, 4 Nov: "is there a way we can improve our speed to reply? any parallel streams?"):
// the quiet-gap rule (src/agent/burst.ts), the early verdict call a decision may use (pipeline.ts
// PrefetchedVerdict), the record version that tells the listener an early call is stale (memory.ts),
// and the plain-words reader every command parser now goes through (src/shared/command.ts).
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildRoomContext } from '../../src/agent/blocks.ts';
import { CAP_MS, gapConfigFromEnv, looksFinished, quietGapMs } from '../../src/agent/burst.ts';
import { readPlain } from '../../src/agent/jobs/decision.ts';
import { RoomMemory } from '../../src/agent/memory.ts';
import { callVerdict, type ModelConfig } from '../../src/agent/model.ts';
import { decide, type Deps, type Input } from '../../src/agent/pipeline.ts';
import type { Poster } from '../../src/agent/post.ts';
import type { RoomRecord } from '../../src/agent/room.ts';
import { AgentState } from '../../src/agent/state.ts';
import { plainCommand } from '../../src/shared/command.ts';
import { readTrace } from '../../src/shared/trace.ts';
import { FakeClaude, item, reviewerMessage, verdictMessage } from '../fake-claude.ts';

describe('quiet gap: short after a finished message, full otherwise', () => {
  const cfg = { longMs: 20_000, shortMs: 12_000 };
  it('reads a finished thought', () => {
    for (const b of ['Could we add a client-facing FAQ page?', 'Morning all, back today.', 'Love it!', 'great idea 👍', 'Sounds good :)', 'approve I7.'])
      expect(looksFinished(b), b).toBe(true);
    for (const b of ['great idea', 'Could we add a FAQ page', 'One more thing,', 'and also…', 'wait...', 'the export, and', 'see:', ''])
      expect(looksFinished(b), b).toBe(false);
  });
  it('waits the short gap after a finished message, the full gap otherwise, and never past the 90 s cap', () => {
    expect(quietGapMs('Could we add a FAQ page?', 0, 0, cfg)).toBe(12_000);
    expect(quietGapMs('Could we add a FAQ page', 0, 0, cfg)).toBe(20_000);
    expect(quietGapMs('and one more thing,', 0, CAP_MS - 5_000, cfg)).toBe(5_000);
    expect(quietGapMs('ok?', 0, CAP_MS + 1, cfg)).toBe(0);
  });
  it('the eval bursts (next message 6–8 s later) still land inside either gap', () => {
    const c = gapConfigFromEnv({});
    expect(c).toEqual({ longMs: 20_000, shortMs: 12_000 });
    expect(c.shortMs).toBeGreaterThan(8_000 + 2_000); // 2 s of delivery jitter to spare
  });
  it('env: CK_BURST_GAP_S stays the full gap; the short one never exceeds it', () => {
    expect(gapConfigFromEnv({ CK_BURST_GAP_S: '20', CK_BURST_GAP_SHORT_S: '8' })).toEqual({ longMs: 20_000, shortMs: 8_000 });
    expect(gapConfigFromEnv({ CK_BURST_GAP_S: '5' })).toEqual({ longMs: 5_000, shortMs: 5_000 });
    expect(gapConfigFromEnv({ CK_BURST_GAP_S: 'x', CK_BURST_GAP_SHORT_S: '' })).toEqual({ longMs: 20_000, shortMs: 12_000 });
  });
});

describe('plain command words (Kash, 4 Nov: a copied `approve I7` arrived as code)', () => {
  it('takes off code, quotes, emphasis and mentions, and leaves the words', () => {
    expect(plainCommand('```approve I7```')).toBe('approve I7');
    expect(plainCommand('```text\napprove I7\n```')).toBe('approve I7');
    expect(plainCommand('“`approve I7`”')).toBe('approve I7');
    expect(plainCommand('@context-keeper: approve I7')).toBe('approve I7');
    expect(plainCommand('not quite, `CSV` too')).toBe('not quite, CSV too');
    expect(plainCommand('@kash')).toBe('@kash');
  });
  it("the owner desk's plain confirm reads through it too", () => {
    expect(readPlain('`confirm`', 'B')).toMatchObject({ action: 'confirm' });
    expect(readPlain('“#3 drop”', 'B')).toMatchObject({ action: 'drop' });
    expect(readPlain('**plan stands**', 'D')).toMatchObject({ action: 'confirm' });
  });
});

const OPUS = 'claude-opus-5-5';
const HAIKU = 'claude-haiku-5-5';
const cfg: ModelConfig = { model: OPUS, reviewerModel: HAIKU, effort: 'medium', fallback: false };
const room: RoomRecord = {
  name: 'ck-test',
  docs: [{ file: 'product.md', text: '# Product\n\n## §2 Payment reminders\n- Automatic reminders at 3, 7 and 14 days overdue (each one can be switched off).\n' }],
  messages: [{ id: 'led-002', at: '2026-09-01T09:30:00+01:00', author: 'Priya', text: 'Reminders are live for everyone since v0.6.' }],
};
const ctx = buildRoomContext(room);
class FakePoster implements Poster {
  sent: string[] = [];
  ownerRoom = { id: 'desk', name: 'ck-owner-desk' };
  async thread(_r: string, _t: string | null, body: string) { this.sent.push(body); return `ev${this.sent.length}`; }
  async owner(body: string) { this.sent.push(body); return `ev${this.sent.length}`; }
}
let dir: string;
const msg = (id: string, body: string): Input => ({ message_id: id, sender: '@switch-slack-x-rowan_demo:localhost', sender_name: 'Rowan', body, received_at: '2026-11-04T09:31:00Z' });
const deps = (claude: FakeClaude, poster: Poster): Deps => ({ claude, cfg, system: 'sys', poster, state: new AgentState(join(dir, 'state.json')), selfSenders: new Set(), traceFile: join(dir, 'trace.jsonl') });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ck-speed-')); delete process.env.CK_FAULT; delete process.env.CK_PAUSE; });

describe('an early verdict call (prefetch)', () => {
  it('used when the burst is the same messages: one verdict call in all, then the gate and reviewer as ever', async () => {
    const claude = new FakeClaude([
      { model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m1')], [{ blockId: 'product.md §2.1' }]) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'm1', supports: true }]) },
    ]);
    const call = callVerdict(claude, cfg, 'sys', ctx, [{ message_id: 'm1', sender: 'Rowan', body: 'Why not reminders?', received_at: '2026-11-04T09:31:00Z' }]);
    const poster = new FakePoster();
    await decide(deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'Why not reminders?')], { prefetched: { ids: ['m1'], call } });
    claude.done();
    expect(claude.calls.map((c) => c.model)).toEqual([OPUS, HAIKU]);
    expect(poster.sent).toHaveLength(1);
    expect(poster.sent[0]).toContain('Automatic reminders at 3, 7 and 14 days overdue');
    const [line] = readTrace(readFileSync(join(dir, 'trace.jsonl'), 'utf8'));
    expect(line.model?.calls).toBe(2);
  });

  it('ignored when the burst grew after it started: the decision calls again', async () => {
    const claude = new FakeClaude([
      { model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m1')], [{ blockId: 'product.md §2.1' }]) }, // the early call (m1 only)
      { model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m1'), item('m2', { job: 'none', verdict: null, reply: '' })], [{ blockId: 'product.md §2.1' }]) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'm1', supports: true }]) },
    ]);
    const call = callVerdict(claude, cfg, 'sys', ctx, [{ message_id: 'm1', sender: 'Rowan', body: 'Why not reminders?', received_at: '2026-11-04T09:31:00Z' }]);
    await call;
    await decide(deps(claude, new FakePoster()), 'room1', 'ck-test', ctx, [msg('m1', 'Why not reminders?'), msg('m2', 'for partners I mean')], { prefetched: { ids: ['m1'], call } });
    claude.done();
    expect(claude.calls).toHaveLength(3);
  });

  it("a failed early call is the decision's model error: fail quiet, retry later, nothing public", async () => {
    const err = Object.assign(new Error('overloaded'), { status: 529 });
    const claude = new FakeClaude([{ model: OPUS, respond: err }]);
    const call = callVerdict(claude, cfg, 'sys', ctx, [{ message_id: 'm1', sender: 'Rowan', body: 'x?', received_at: '2026-11-04T09:31:00Z' }]);
    call.catch(() => {});
    const poster = new FakePoster();
    const r = await decide(deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'x?')], { prefetched: { ids: ['m1'], call } });
    expect(r.retry).toBe(true);
    expect(poster.sent.every((b) => b.startsWith("Couldn't check this one"))).toBe(true);
    expect(existsSync(join(dir, 'trace.jsonl'))).toBe(true);
  });
});

describe('record version (an early call is stale once the record changes)', () => {
  it('goes up on a live message and a document change, not on a repeat', async () => {
    const docs = [{ id: 'd1', name: 'Product', description: '(seeded project document, product.md)' }];
    const mem = new RoomMemory({
      op: async (_r, name) => {
        if (name === 'list_references') return { documents: docs };
        if (name === 'load_internal_documents') return { documents: docs.map((d) => ({ id: d.id, content: `# ${d.name}\n\n## §1 Thing\n- A line.\n` })) };
        if (name === 'read_context') return { threads: [] };
        return {};
      },
      agentId: 'a1', selfNames: () => new Set(), selfSenders: new Set(), log: () => {},
    });
    await mem.record('r1', 'ck-test');
    const v0 = mem.version('r1');
    mem.addLive('r1', { id: 'm1', at: '2026-11-04T09:31:00Z', author: 'Rowan', text: 'hi', thread: null });
    expect(mem.version('r1')).toBe(v0 + 1);
    mem.addLive('r1', { id: 'm1', at: '2026-11-04T09:31:00Z', author: 'Rowan', text: 'hi', thread: null });
    expect(mem.version('r1')).toBe(v0 + 1);
    await mem.refresh('r1');
    expect(mem.version('r1')).toBe(v0 + 1); // nothing changed in Switch
    docs.push({ id: 'd2', name: 'Status', description: '(seeded project document, status.md)' });
    await mem.refresh('r1');
    expect(mem.version('r1')).toBe(v0 + 2);
  });
});
