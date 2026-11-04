// Job C offline checks: a brief on a person's first message after joining (or returning), once per
// person per room, never for the owner, and nothing from the owner desk: the model never sees it, and
// a line that isn't verbatim in the record is dropped by the gate.
import { beforeEach, describe, expect, it } from 'vitest';
import { briefTrigger, MAX_BRIEF_ATTEMPTS, resumableBriefs, runBrief, TALK_IT_THROUGH } from '../../src/agent/jobs/brief.ts';
import { decide } from '../../src/agent/pipeline.ts';
import { FakeClaude, item, reviewerMessage, verdictMessage } from '../fake-claude.ts';
import { ctx, details, FakePoster, HAIKU, jobItem, KASH, msg, OPUS, briefMessage, room, ROWAN, setup } from './jobs-fixture.ts';

let t: ReturnType<typeof setup>;
beforeEach(() => { t = setup('ck-jobC-'); });

const ALEX = '@switch-slack-conn-alex:localhost';
const alexFirst = msg('a1', 'Hi all! Why not run the pilot with five agencies?', ALEX, 'Alex', { received_at: '2026-11-04T10:00:00Z' });
const goodLines = [
  { kind: 'decided', headline: 'Three agencies, 25 clients each', text: 'Kash decided: support is Priya plus Kash.', block: 'pilot-plan.md §2 D2', quote: 'Three agencies, max 25 clients each' },
  // a greeting from the model is dropped: the post's first line already welcomes them (Kash, 4 Nov)
  { kind: 'talk_to', headline: 'Welcome, Alex! Priya runs onboarding', text: '', block: 'pilot-plan.md §3.1', quote: 'Priya: onboarding calls and pilot support.' },
];

describe('job C: when a brief fires', () => {
  it('fires on the first message after a room_join, once per person per room, and never for the owner', () => {
    const d = t.deps(new FakeClaude([]));
    d.state.markJoined('room1', ALEX);
    expect(briefTrigger(d, 'room1', room, alexFirst)).toEqual({ kind: 'joiner', since: null });
    d.state.markBriefed('room1', ALEX);
    expect(briefTrigger(d, 'room1', room, alexFirst)).toBeNull(); // once per person per room
    expect(briefTrigger(d, 'room2', room, alexFirst)).not.toBeNull(); // per room
    expect(briefTrigger(d, 'room1', room, msg('k1', 'Morning all', KASH, 'Kash'))).toBeNull(); // the owner
  });

  it('a returner (first message after a long gap) gets one, with the date they last posted; a regular poster does not', () => {
    const d = t.deps(new FakeClaude([]));
    expect(briefTrigger(d, 'room1', room, msg('r1', 'Back! Lots of ideas.', ROWAN, 'Rowan', { received_at: '2026-11-04T09:31:00Z' })))
      .toEqual({ kind: 'returner', since: '2026-10-07T09:00:00+01:00' });
    expect(briefTrigger(d, 'room1', room, msg('p1', 'Quick one about invoices', '@x-priya', 'Priya', { received_at: '2026-11-03T09:00:00Z' }))).toBeNull();
  });

  it('matches the sender to the record case-insensitively (a lowercase handle is not a joiner)', () => {
    const d = t.deps(new FakeClaude([]));
    expect(briefTrigger(d, 'room1', room, msg('p2', 'Lunch run in 10?', '@x-priya', 'priya', { received_at: '2026-11-03T09:00:00Z' }))).toBeNull();
    expect(briefTrigger(d, 'room1', room, msg('r2', 'Back!', ROWAN, 'rowan', { received_at: '2026-11-04T09:31:00Z' })))
      .toEqual({ kind: 'returner', since: '2026-10-07T09:00:00+01:00' });
  });
});

describe('job C: the brief', () => {
  it('posts a short personal brief in the thread of their first message, then job A answers as usual', async () => {
    const claude = new FakeClaude([
      { model: OPUS, respond: briefMessage(goodLines) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'line1', supports: true }, { id: 'line2', supports: true }]) },
      { model: OPUS, respond: verdictMessage(OPUS, ctx, [jobItem('a1', { job: 'none' })], []) },
    ]);
    const poster = new FakePoster();
    const d = t.deps(claude, poster);
    d.state.markJoined('room1', ALEX);
    const line = await runBrief(d, 'room1', 'ck-test', ctx, alexFirst, briefTrigger(d, 'room1', room, alexFirst)!);
    await decide(d, 'room1', 'ck-test', ctx, [alexFirst]);
    claude.done();

    expect(poster.pub()).toHaveLength(1);
    const brief = poster.pub()[0];
    expect(brief.thread).toBe('a1');
    expect(brief.body.split('\n')).toEqual([
      '👋 **Welcome, Alex** · a quick catch-up on where things stand',
      // a marker for its kind, a bold headline, one short follow-on at most, the source as people know it
      '✅ **Three agencies, 25 clients each** · Kash decided: support is Priya plus Kash. — Ledgerly pilot plan › Decisions (Kash, 6 Oct)',
      '💬 **Priya runs onboarding** — Ledgerly pilot plan › Who does what (30 Oct)',
      TALK_IT_THROUGH,
    ]);
    expect(line).toMatchObject({ kind: 'brief', trigger: 'room_join' });
    expect(line.items[0]).toMatchObject({ job: 'none', brief_for: 'Alex' });
    expect(line.items[0].sources.map((s) => s.ref)).toEqual(['pilot-plan.md §2', 'pilot-plan.md §3']);
    expect(line.posts.map((p) => p.route)).toEqual(['public_thread']);
    expect(d.state.isBriefed('room1', ALEX)).toBe(true);
    // The brief call saw only the record and the person, as data.
    const params = claude.calls[0].params;
    expect(params.tool_choice).toEqual({ type: 'auto' }); // forced tool_choice is a 400 on Opus 5.5
    expect(params.messages[0].content.at(-1).text).toContain('"kind":"joiner"');
  });

  it('nothing from the owner desk: the model never sees desk text, and a line not in the record is dropped', async () => {
    const secret = 'Rowan keeps pushing back on D2, I may let Northbank go';
    // A clash sits open in the owner desk, with the owner's private words in the pending store.
    const poster = new FakePoster();
    const d = t.deps(new FakeClaude([{ model: OPUS, respond: verdictMessage(OPUS, ctx, [jobItem('m9', { job: 'D', restriction: 'project', clashes_with: 'D2', details: details({ summary: secret }) })], []) }]), poster);
    await decide(d, 'room1', 'ck-test', ctx, [msg('m9', 'One agency is plenty.')]);
    expect(poster.desk()[0].body).toContain(secret);

    const claude = new FakeClaude([
      { model: OPUS, respond: briefMessage([...goodLines, { kind: 'open', text: 'Kash may let Northbank go.', block: 'pilot-plan.md §2 D2', quote: secret }]) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'line1', supports: true }, { id: 'line2', supports: true }]) },
    ]);
    const d2 = t.deps(claude, poster);
    const line = await runBrief(d2, 'room1', 'ck-test', ctx, alexFirst, { kind: 'joiner', since: null });
    claude.done();
    expect(JSON.stringify(claude.calls.map((c) => c.params))).not.toContain('Northbank go');
    const brief = poster.pub().at(-1)!;
    expect(brief.body).not.toMatch(/Northbank/);
    expect(line.error).toMatch(/brief_gate: line 3 dropped/);
    // The reviewer saw only the two lines that passed the gate.
    expect(JSON.parse(claude.calls[1].params.messages[0].content).checks).toHaveLength(2);
  });

  it('a line the reviewer rejects is dropped; with no line left, nothing posts', async () => {
    const claude = new FakeClaude([
      { model: OPUS, respond: briefMessage([goodLines[0]]) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'line1', supports: false, issue: 'adds a reason' }]) },
    ]);
    const poster = new FakePoster();
    const line = await runBrief(t.deps(claude, poster), 'room1', 'ck-test', ctx, alexFirst, { kind: 'joiner', since: null });
    expect(poster.sent).toEqual([]);
    expect(line.kind).toBe('silence');
    expect(line.error).toMatch(/brief_reviewer: line 1 dropped.*brief_gate_blocked/);
  });

  it('a model error means no brief, nothing public, and no second attempt for that person', async () => {
    const err = Object.assign(new Error('overloaded'), { status: 529 });
    const poster = new FakePoster();
    const d = t.deps(new FakeClaude([{ model: OPUS, respond: err }]), poster);
    d.state.markJoined('room1', ALEX);
    const line = await runBrief(d, 'room1', 'ck-test', ctx, alexFirst, { kind: 'joiner', since: null });
    expect(poster.sent).toEqual([]);
    expect(line.kind).toBe('silence');
    expect(line.error).toMatch(/brief_model_error/);
    expect(briefTrigger(d, 'room1', room, alexFirst)).toBeNull();
  });
});

// R2 (live robustness run, 4 Nov): the agent was killed after Rowan's first message sat in the saved
// burst queue but before his returner brief posted. He had already been marked briefed, so the restart
// re-queued the message, job A answered it, and the brief was gone for good. Each "process" below is a
// fresh AgentState read from the same state file, as src/agent/main.ts starts; the order is main.ts's:
// beginBrief, then runBrief off the stream, job A's decision waiting on the brief's text post.
describe('job C: a restart before the brief posts (R2)', () => {
  const at = (s: number) => `2026-11-04T09:3${s}:00Z`;
  const b1 = [
    msg('r1', 'Back! Where did we land on the agency count?', ROWAN, 'rowan', { received_at: at(1) }),
    msg('r2', 'And who handles onboarding now?', ROWAN, 'rowan', { received_at: at(2) }),
    msg('r3', 'Sorry, catching up on three weeks here.', ROWAN, 'rowan', { received_at: at(3) }),
  ];
  const briefLines = [goodLines[0]];
  const hang = () => new FakeClaude([{ model: OPUS, respond: (() => new Promise(() => {})) as never }]);

  /** Process 1: Rowan's first message triggers his brief; the process dies while the brief's model call
   *  is in flight (the message is in the saved queue, nothing has posted). */
  async function killedMidBrief() {
    const poster = new FakePoster();
    const d = t.deps(hang(), poster);
    const trig = briefTrigger(d, 'room1', room, b1[0])!;
    expect(trig).toEqual({ kind: 'returner', since: '2026-10-07T09:00:00+01:00' });
    expect(d.state.beginBrief('room1', b1[0], trig, 'rowan')).toBe(1);
    void runBrief(d, 'room1', 'ck-test', ctx, b1[0], trig); // never returns: killed here
    await new Promise((r) => setTimeout(r, 10));
    expect(poster.sent).toEqual([]);
    return trig;
  }

  it('the next start runs the brief once, then job A sends one combined reply for the burst', async () => {
    const trig = await killedMidBrief();

    // Process 2. The rest of the burst arrives while it starts: no second brief is triggered for Rowan.
    const claude = new FakeClaude([
      { model: OPUS, respond: briefMessage(briefLines) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'line1', supports: true }]) },
      { model: OPUS, respond: verdictMessage(OPUS, ctx, b1.map((m) => item(m.message_id)), [{ blockId: 'pilot-plan.md §2 D2' }]) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, b1.map((m) => ({ id: m.message_id, supports: true }))) },
    ]);
    const poster = new FakePoster();
    const d = t.deps(claude, poster);
    for (const m of b1.slice(1)) expect(briefTrigger(d, 'room1', room, m)).toBeNull();
    const todo = resumableBriefs(d.state);
    expect(todo).toHaveLength(1);
    const { roomId, brief } = todo[0];
    expect(brief).toMatchObject({ input: { message_id: 'r1' }, trigger: trig, handle: 'rowan', attempts: 1 });
    expect(d.state.beginBrief(roomId, brief.input, brief.trigger, brief.handle)).toBe(2);
    const line = await runBrief(d, roomId, 'ck-test', ctx, brief.input, brief.trigger); // the gate job A waits on
    await decide(d, 'room1', 'ck-test', ctx, b1);
    claude.done();

    expect(line.kind).toBe('brief');
    expect(poster.pub().map((p) => [p.thread, p.body.split('\n')[0]])).toEqual([
      ['r1', '👋 **Welcome back, Rowan** · here\'s what changed while you were away'],
      ['r1', expect.any(String)],
    ]);
    const traces = t.traces();
    expect(traces.filter((l) => l.kind === 'brief')).toHaveLength(1);
    const replies = traces.filter((l) => l.kind === 'reply');
    expect(replies).toHaveLength(1);
    expect(replies[0].inputs.map((i) => i.message_id)).toEqual(['r1', 'r2', 'r3']);
    expect(d.state.isBriefed('room1', ROWAN)).toBe(true);
    expect(d.state.pendingBriefs()).toEqual([]);
    expect(resumableBriefs(t.deps(new FakeClaude([])).state)).toEqual([]); // a third start: nothing more
  });

  it(`a brief cut off ${MAX_BRIEF_ATTEMPTS} times is given up on: no third attempt, no retry storm`, async () => {
    await killedMidBrief();
    // Process 2 dies mid-brief too.
    const d2 = t.deps(hang());
    const [{ roomId, brief }] = resumableBriefs(d2.state);
    expect(d2.state.beginBrief(roomId, brief.input, brief.trigger, brief.handle)).toBe(2);
    void runBrief(d2, roomId, 'ck-test', ctx, brief.input, brief.trigger);
    await new Promise((r) => setTimeout(r, 10));
    // Process 3: nothing to re-run; Rowan counts as briefed, so his next message triggers nothing.
    const d3 = t.deps(new FakeClaude([]));
    expect(resumableBriefs(d3.state)).toEqual([]);
    expect(d3.state.isBriefed('room1', ROWAN)).toBe(true);
    expect(d3.state.pendingBriefs()).toEqual([]);
    expect(briefTrigger(d3, 'room1', room, b1[1])).toBeNull();
  });
});
