// Job A offline checks (eval-harness §10b): R1 quote gate, R3 own posts ignored, R4 fail quiet.
// A scripted fake Claude asserts the call sequence; no network, no cost.
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRoomContext } from '../../src/agent/blocks.ts';
import { resetFaults, type ModelConfig } from '../../src/agent/model.ts';
import { decide, decideWithRetry, type Deps, type Input } from '../../src/agent/pipeline.ts';
import type { Poster } from '../../src/agent/post.ts';
import type { RoomRecord } from '../../src/agent/room.ts';
import { AgentState, readJsonl } from '../../src/agent/state.ts';
import { quoteVerified } from '../../src/shared/quote.ts';
import { readTrace, type TraceLine } from '../../src/shared/trace.ts';
import { FakeClaude, item, reviewerMessage, verdictMessage } from '../fake-claude.ts';

const OPUS = 'claude-opus-5-5';
const HAIKU = 'claude-haiku-5-5';
const cfg: ModelConfig = { model: OPUS, reviewerModel: HAIKU, effort: 'medium', fallback: false };

const room: RoomRecord = {
  name: 'ck-test',
  docs: [{
    file: 'product.md',
    text: '# Product\n\nOwner: Kash. Last updated 20 Oct 2026.\n\n## §2 Payment reminders\n- Automatic reminders at 3, 7 and 14 days overdue (each one can be switched off).\n- Three tone presets: friendly, neutral and firm.\n',
  }],
  messages: [
    { id: 'led-002', at: '2026-09-01T09:30:00+01:00', author: 'Priya', text: 'Reminders are live for everyone since v0.6, so 3/7/14 days with the three tones.' },
  ],
};
const ctx = buildRoomContext(room);
const SELF = '@context-keeper:localhost';

class FakePoster implements Poster {
  public sent: { route: string; body: string; thread: string | null }[] = [];
  ownerRoom = { id: 'owner-room', name: 'ck-owner-desk' };
  async thread(_room: string, thread: string | null, body: string) { this.sent.push({ route: 'public', body, thread }); return `ev${this.sent.length}`; }
  async owner(body: string) { this.sent.push({ route: 'owner', body, thread: null }); return `ev${this.sent.length}`; }
}

let dir: string;
let traceFile: string;
function deps(claude: FakeClaude, poster = new FakePoster(), extra: Partial<Deps> = {}): Deps {
  return { claude, cfg, system: 'sys', poster, state: new AgentState(join(dir, 'state.json')), selfSenders: new Set([SELF]), traceFile, ...extra };
}
const traces = (): TraceLine[] => (existsSync(traceFile) ? readTrace(readFileSync(traceFile, 'utf8')) : []);
const msg = (id: string, body: string, sender = '@switch-slack-x-cosmicboard:localhost'): Input => ({ message_id: id, sender, sender_name: 'Rowan', body, received_at: '2026-11-04T09:31:00Z' });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ck-jobA-'));
  traceFile = join(dir, 'trace.jsonl');
  delete process.env.CK_FAULT;
  delete process.env.CK_PAUSE;
  resetFaults();
});
afterEach(() => { delete process.env.CK_FAULT; });

describe('block layout', () => {
  it('every block body is verbatim in its scored source, and ids sit in the header', () => {
    for (const blocks of ctx.table) for (const b of blocks) {
      expect(quoteVerified(b.body, ctx.sourceText.get(b.ref)!)).toBe(true);
      expect(b.text.startsWith(`[${b.blockId} `)).toBe(true);
    }
    expect(ctx.table.flat().map((b) => b.blockId)).toEqual(['product.md header', 'product.md §2.1', 'product.md §2.2', 'led-002']);
    expect(ctx.documents.at(-1)!.cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('happy path', () => {
  it('covered + verified quote + reviewer pass → one thread reply carrying the ref and the verbatim quote', async () => {
    const claude = new FakeClaude([
      { model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m1')], [{ blockId: 'product.md §2.1' }, { blockId: 'led-002' }]) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'm1', supports: true }]) },
    ]);
    const poster = new FakePoster();
    const r = await decide(deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'Why don\'t we add automatic payment reminders?')]);
    claude.done();
    expect(poster.sent).toHaveLength(1);
    expect(poster.sent[0].thread).toBe('m1');
    expect(poster.sent[0].body).toContain('Automatic reminders at 3, 7 and 14 days overdue');
    expect(poster.sent[0].body).toContain('led-002');
    const [line] = traces();
    expect(line.kind).toBe('reply');
    expect(line.items[0].verdict).toBe('covered');
    expect(line.items[0].sources.map((s) => s.ref)).toEqual(['product.md §2', 'led-002']);
    for (const s of line.items[0].sources) expect(quoteVerified(s.quote, ctx.sourceText.get(s.ref)!)).toBe(true);
    expect(line.model?.calls).toBe(2);
    expect(r.retry).toBe(false);
  });
});

describe('R1 quote gate', () => {
  it('a quote that is not in the source never posts as covered: it drops to might-be-related with the link', async () => {
    const claude = new FakeClaude([
      { model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m1')], [{ blockId: 'product.md §2.1', text: '[product.md §2.1 · Payment reminders · doc 2026-10-20] Automatic reminders every single day, forever.' }]) },
      // no reviewer call: nothing strong survived the gate
    ]);
    const poster = new FakePoster();
    await decide(deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'Can we get daily reminders?')]);
    claude.done();
    const [line] = traces();
    expect(line.items[0].verdict).toBe('might-be-related');
    expect(line.items[0].sources).toEqual([]);
    expect(line.error).toMatch(/gate: m1 covered→might-be-related/);
    expect(poster.sent.every((p) => !/every single day/.test(p.body))).toBe(true);
  });

  it('covered with no citation at all → silence and gate_blocked', async () => {
    const claude = new FakeClaude([{ model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m1')], []) }]);
    const poster = new FakePoster();
    await decide(deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'Why not reminders?')]);
    claude.done();
    expect(poster.sent).toEqual([]);
    const [line] = traces();
    expect(line.kind).toBe('silence');
    expect(line.items[0].verdict).toBeNull();
    expect(line.error).toMatch(/gate_blocked/);
  });

  it('a verified quote the reviewer says does not support the claim → might-be-related, never covered', async () => {
    const claude = new FakeClaude([
      { model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m1', { claim: 'Covered: meeting reminders for partner calls are live.', reply: 'Meeting reminders for partner calls are live.' })], [{ blockId: 'led-002' }]) },
      { model: HAIKU, respond: (p: any) => {
        const sent = JSON.parse(p.messages[0].content);
        expect(Object.keys(sent)).toEqual(['checks']); // the reviewer sees only the claim + quotes
        // Short ids (c1…) go to the reviewer and are mapped back to message ids.
        expect(sent.checks[0]).toEqual({ id: 'c1', claim: 'Covered: meeting reminders for partner calls are live.', quotes: [ctx.table[1][0].text] });
        return reviewerMessage(HAIKU, [{ id: 'c1', supports: false, issue: 'payment reminders, not meetings' }]);
      } },
    ]);
    const poster = new FakePoster();
    await decide(deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'Can partners get reminders before calls?')]);
    claude.done();
    const [line] = traces();
    expect(line.items[0].verdict).toBe('might-be-related');
    expect(poster.sent).toHaveLength(1);
    expect(poster.sent[0].body).not.toContain('Meeting reminders for partner calls are live');
  });
});

describe('R3 own posts ignored', () => {
  it('a message from our own sender id makes no model call and no trace line', async () => {
    const claude = new FakeClaude([]);
    const r = await decide(deps(claude), 'room1', 'ck-test', ctx, [msg('m9', 'Good news: reminders exist.', SELF)]);
    claude.done();
    expect(r.trace).toBeNull();
    expect(traces()).toEqual([]);
  });

  it('in a mixed batch, our own post never appears as an input', async () => {
    const claude = new FakeClaude([
      { model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m1', { job: 'none', verdict: 'none', reply: '' })], []) },
    ]);
    await decide(deps(claude), 'room1', 'ck-test', ctx, [msg('m9', 'my own reply', SELF), msg('m1', 'morning all')]);
    claude.done();
    const lines = traces();
    expect(lines).toHaveLength(1);
    expect(lines.flatMap((l) => l.inputs.map((i) => i.message_id))).toEqual(['m1']);
    expect(lines.flatMap((l) => l.items.map((i) => i.message_id))).toEqual(['m1']);
  });

  it('a message handled once is not handled again (restart safety)', async () => {
    const d = deps(new FakeClaude([{ model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m1', { job: 'none', verdict: 'none' })], []) }]));
    await decide(d, 'room1', 'ck-test', ctx, [msg('m1', 'hi all')]);
    const again = new FakeClaude([]);
    const r = await decide({ ...d, claude: again, state: new AgentState(join(dir, 'state.json')) }, 'room1', 'ck-test', ctx, [msg('m1', 'hi all')]);
    again.done();
    expect(r.trace).toBeNull();
  });
});

describe('R4 fail quiet', () => {
  it('CK_FAULT=model_500: nothing public, one owner note, then the retry after 60 s posts the reply', async () => {
    process.env.CK_FAULT = 'model_500';
    const claude = new FakeClaude([
      // attempt 1 never reaches the model (the fault fires first); attempt 2: verdict, then reviewer
      { model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m1')], [{ blockId: 'product.md §2.1' }]) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'm1', supports: true }]) },
    ]);
    const poster = new FakePoster();
    const slept: number[] = [];
    const results = await decideWithRetry(deps(claude, poster, { sleep: async (ms) => { slept.push(ms); } }), 'room1', 'ck-test', ctx, [msg('m1', 'Why don\'t we add payment reminders?')]);
    claude.done();
    expect(slept).toEqual([60_000]);
    expect(poster.sent.map((p) => p.route)).toEqual(['owner', 'public']);
    expect(poster.sent[0].body).toMatch(/^Couldn't check this one/);
    const [fail, ok] = traces();
    expect(fail.kind).toBe('owner_note');
    expect(fail.posts.map((p) => p.route)).toEqual(['owner_private']);
    expect(fail.error).toMatch(/model_500/);
    expect(fail.items[0].verdict).toBeNull();
    expect(ok.kind).toBe('reply');
    expect(ok.items[0].verdict).toBe('covered');
    expect(results.map((r) => r.retry)).toEqual([true, false]);
  });

  it('a 500 on both attempts: still nothing public, and the owner hears once', async () => {
    const err = Object.assign(new Error('overloaded'), { status: 529 });
    const claude = new FakeClaude([{ model: OPUS, respond: err }, { model: OPUS, respond: err }]);
    const poster = new FakePoster();
    await decideWithRetry(deps(claude, poster, { sleep: async () => {} }), 'room1', 'ck-test', ctx, [msg('m1', 'Why not reminders?')]);
    claude.done();
    expect(poster.sent.map((p) => p.route)).toEqual(['owner']);
  });

  it('a reviewer timeout fails quiet too: no public post, nothing claimed covered', async () => {
    const claude = new FakeClaude([
      { model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m1')], [{ blockId: 'product.md §2.1' }]) },
      { model: HAIKU, respond: Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }) },
    ]);
    const poster = new FakePoster();
    const r = await decide(deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'Why not reminders?')]);
    claude.done();
    expect(poster.sent.map((p) => p.route)).toEqual(['owner']);
    expect(traces()[0].items[0].verdict).toBeNull();
    expect(r.retry).toBe(true);
  });

  it('401: stop the agent and alert the owner, no retry', async () => {
    const claude = new FakeClaude([{ model: OPUS, respond: Object.assign(new Error('invalid x-api-key'), { status: 401 }) }]);
    const poster = new FakePoster();
    let stopped = '';
    const results = await decideWithRetry(deps(claude, poster, { onFatal: (w) => { stopped = w; }, sleep: async () => { throw new Error('must not retry'); } }), 'room1', 'ck-test', ctx, [msg('m1', 'Why not reminders?')]);
    claude.done();
    expect(results).toHaveLength(1);
    expect(stopped).toMatch(/401|invalid/);
    expect(poster.sent.map((p) => p.route)).toEqual(['owner']);
    expect(poster.sent[0].body).toMatch(/stopped/);
  });
});

describe('state', () => {
  it('skips a torn last JSONL line', () => {
    expect(readJsonl('{"a":1}\n{"a":2}\n{"a":')).toEqual([{ a: 1 }, { a: 2 }]);
  });
  it('the same reply in the same thread is never posted twice', async () => {
    const run = () => new FakeClaude([
      { model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m1')], [{ blockId: 'product.md §2.1' }]) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'm1', supports: true }]) },
    ]);
    const poster = new FakePoster();
    const state = new AgentState(join(dir, 'state.json'));
    await decide({ ...deps(run(), poster), state }, 'room1', 'ck-test', ctx, [msg('m1', 'reminders?')]);
    // the processed list is lost (say, a crash before it was saved) but the post key survives
    const state2 = new AgentState(join(dir, 'state.json'));
    (state2 as any).data.rooms.room1.processed = [];
    await decide({ ...deps(run(), poster), state: state2 }, 'room1', 'ck-test', ctx, [msg('m1', 'reminders?')]);
    expect(poster.sent.filter((p) => p.route === 'public')).toHaveLength(1);
    expect(traces()[1].error).toMatch(/duplicate suppressed/);
  });
});
