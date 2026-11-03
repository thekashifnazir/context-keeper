// Job C offline checks: a brief on a person's first message after joining (or returning), once per
// person per room, never for the owner, and nothing from the owner desk: the model never sees it, and
// a line that isn't verbatim in the record is dropped by the gate.
import { beforeEach, describe, expect, it } from 'vitest';
import { briefTrigger, runBrief, TALK_IT_THROUGH } from '../../src/agent/jobs/brief.ts';
import { decide } from '../../src/agent/pipeline.ts';
import { FakeClaude, reviewerMessage, verdictMessage } from '../fake-claude.ts';
import { ctx, details, FakePoster, HAIKU, jobItem, KASH, msg, OPUS, briefMessage, room, ROWAN, setup } from './jobs-fixture.ts';

let t: ReturnType<typeof setup>;
beforeEach(() => { t = setup('ck-jobC-'); });

const ALEX = '@switch-slack-conn-alex:localhost';
const alexFirst = msg('a1', 'Hi all! Why not run the pilot with five agencies?', ALEX, 'Alex', { received_at: '2026-11-04T10:00:00Z' });
const goodLines = [
  { kind: 'decided', text: 'The pilot runs with three agencies, 25 clients each (Kash decided: support is Priya plus Kash).', block: 'pilot-plan.md §2 D2', quote: 'Three agencies, max 25 clients each' },
  { kind: 'talk_to', text: 'Priya runs onboarding calls and pilot support.', block: 'pilot-plan.md §3.1', quote: 'Priya: onboarding calls and pilot support.' },
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
      'Welcome, Alex. A quick catch-up on where things stand:',
      '• The pilot runs with three agencies, 25 clients each (Kash decided: support is Priya plus Kash). (pilot-plan.md §2)',
      '• Priya runs onboarding calls and pilot support. (pilot-plan.md §3)',
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
