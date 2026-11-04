import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TraceLine } from '../src/shared/trace.ts';
import type { Capture, MmPost } from './capture.ts';
import { parseArgs, rescore, ROOT } from './cli.ts';
import { loadCases, loadRoomContent } from './content.ts';
import { score } from './score.ts';

const HAND = join(ROOT, 'test/fixtures/hand-capture');

describe('hand-built capture', () => {
  const r = rescore(HAND);
  const c = (id: string) => r.cases.find((x) => x.id === id)!;

  it('passes a cited, threaded, honest covered reply (T05)', () => {
    expect(c('T05').pass).toBe(true);
    expect(c('T05').rules.P3.reason).toMatch(/pilot-plan\.md §2/);
  });
  it('fails a covered reply whose quote is not in the source, and counts it confident wrong (T06)', () => {
    expect(c('T06').pass).toBe(false);
    expect(c('T06').rules.P3).toEqual({ status: 'fail', reason: 'research.md §1: quote not in source' });
    expect(c('T06').flags.confident_wrong).toBe(true);
    expect(r.summary.confident_wrong).toBe(1);
  });
  it('fails a case whose trace claims a post nobody saw (T08, trace_mismatch)', () => {
    expect(c('T08').rules.P5.status).toBe('fail');
    expect(c('T08').rules.P5.reason).toMatch(/^trace_mismatch: claimed but not seen d-t08:public_thread; seen but not in trace mmp-r08$/);
    expect(c('T08').flags.trace_mismatch).toBe(true);
    expect(c('T08').rules.P4.status).toBe('pass');
  });
  it('passes a silence with no posts and a silence trace line (T15)', () => {
    expect(c('T15').pass).toBe(true);
    expect(c('T15').rules.P1.reason).toBe('quiet: no visible posts, trace says silence');
  });
  it('passes a project clash sent to the owner desk with a neutral public reply (T12)', () => {
    expect(c('T12').pass).toBe(true);
    expect(c('T12').rules.P4.reason).toBe('owner desk names D2; one neutral thread reply');
  });
  it('reports the numbers', () => {
    expect(r.summary.overall).toEqual({ passed: 3, total: 5 });
    expect(r.summary.job_a).toEqual({ passed: 1, total: 3 });
    expect(r.summary.quiet).toEqual({ passed: 1, total: 1 });
    expect(r.summary.diagnostics.trace_mismatch).toBe(1);
    expect(r.pre_replay_posts.map((p) => p.post_id)).toEqual(['mmp-seed-1']); // the system post is skipped
    expect(r.unattributed).toEqual([]);
  });
  it('gives the same JSON every time', () => {
    expect(JSON.stringify(rescore(HAND))).toBe(JSON.stringify(r));
  });
});

// ── Synthetic captures, built in code ──
const ROOM = 'ledgerly-pilot';
const RIV = 'riverside-build-night';
const { cases } = loadCases(ROOT, 'main');
const content = { [ROOM]: loadRoomContent(ROOT, ROOM), [RIV]: loadRoomContent(ROOT, RIV) };
const msg = (id: string) => cases.find((c) => c.id === id)!.message;
const T0 = 1_800_000_000_000;

interface Build { cases: [string, number][]; lines: Partial<TraceLine>[]; posts: Partial<MmPost>[]; joins?: Capture['meta']['joins'] }
function build(b: Build) {
  const capture: Capture = {
    meta: {
      schema: 'ck.capture/1', run_id: 'rtest', set: 'main', mode: 'fixture', model: null, burst_gap_s: 20,
      started_at: '2026-11-04T00:00:00.000Z', t0_ms: T0, ended_at_ms: T0 + 3_600_000,
      agent: { name: 'context-keeper', mm_user_id: 'bot' }, owner_username: 'kash',
      personas: { Kash: 'kash', Priya: 'priya', Sam: 'sam', Rowan: 'rowan', Alex: 'alex', Dana: 'dana' },
      rooms: {
        [ROOM]: { room_id: 'R1', room_name: 'ck-eval-rtest-ledgerly', channel_id: 'C1', owner_desk_channel_id: 'DESK' },
        [RIV]: { room_id: 'R2', room_name: 'ck-eval-rtest-riverside', channel_id: 'C2', owner_desk_channel_id: 'DESK2' },
      },
      joins: b.joins ?? [],
      cases: b.cases.map(([id, t]) => ({ id, post_id: `p-${id}`, create_at: T0 + t })),
      versions: { harness_sha: null, agent_sha: null, switch: null, mattermost: null },
    },
    posts: b.posts.map((p, i) => ({ id: `v${i}`, channel_id: 'C1', user_id: 'bot', root_id: '', message: '', type: '', create_at: T0, ...p })),
    trace: b.lines.map((l, i) => ({
      schema: 'ck.trace/1', ts: new Date(T0 + 1000 * i).toISOString(), decision_id: `d${i}`, room_id: 'R1', room_name: 'x',
      kind: 'reply', trigger: 'message', inputs: [], burst: null, items: [], posts: [], model: null, error: null, ...l,
    }) as TraceLine),
  };
  return score({ cases, content, capture, set_label: 'main', cases_sha256: 'x', content_sha256: 'y' });
}
const inp = (id: string, sender: string, extra = '') => ({ message_id: `s-${id}`, sender, body: msg(id) + extra, received_at: '2026-11-04T00:00:00Z' });
const item = (id: string, over: Record<string, unknown> = {}) => ({ message_id: `s-${id}`, job: 'A' as const, verdict: 'covered' as const, restriction: null, clashes_with: null, sources: [], decision_record: null, brief_for: null, ...over });
const tpost = (body: string, route: 'public_thread' | 'owner_private' = 'public_thread') => ({ route, room_id: 'R1', room_name: 'x', thread_id: null, event_id: null, body });

describe('bursts', () => {
  const B1: [string, number][] = [['T01', 0], ['T02', 8000], ['T03', 14000]];
  const reply = 'Welcome back Rowan! All three exist: reminders (product.md §2), direct debit (product.md §3), and the client portal (product.md §5).';
  const src = [{ ref: 'product.md §2', quote: 'Automatic reminders at 3, 7 and 14 days overdue' }];
  it('one combined reply covering every member is "answered once"', () => {
    const r = build({
      cases: B1,
      lines: [{ inputs: ['T01', 'T02', 'T03'].map((i) => inp(i, 'rowan')), items: ['T01', 'T02', 'T03'].map((i) => item(i, { sources: src })), posts: [tpost(reply)] }],
      posts: [{ root_id: 'p-T01', message: reply, create_at: T0 + 40000 }],
    });
    expect(r.bursts[0]).toMatchObject({ id: 'B1', answered_once: true });
    expect(r.cases.find((c) => c.id === 'T02')!.rules.P4.status).toBe('pass');
    expect(r.cases.find((c) => c.id === 'T01')!.flags.thread_ok).toBe(true);
  });
  it('three separate replies is not', () => {
    const r = build({
      cases: B1,
      lines: ['T01', 'T02', 'T03'].map((i) => ({ inputs: [inp(i, 'rowan')], items: [item(i, { sources: src })], posts: [tpost(`${reply} ${i}`)] })),
      posts: ['T01', 'T02', 'T03'].map((i) => ({ root_id: `p-${i}`, message: `${reply} ${i}`, create_at: T0 + 40000 })),
    });
    expect(r.bursts[0].answered_once).toBe(false);
    expect(r.cases.every((c) => c.rules.P4.status === 'fail')).toBe(true);
  });
  it('a joiner brief counts as seen and is not the burst reply', () => {
    const brief = 'Hi Alex, quick catch-up: the build night is one evening, 18:00 to 21:30.';
    const ans = 'Good ideas, Alex. A weekday evening was chosen (event-plan.md §2).';
    const r = build({
      cases: [['T16', 20000], ['T17', 27000], ['T18', 35000]],
      joins: [{ room: RIV, username: 'alex', at_ms: T0 }],
      lines: [
        { room_id: 'R2', kind: 'brief', trigger: 'room_join', ts: new Date(T0 + 5000).toISOString(), posts: [tpost(brief)] },
        { room_id: 'R2', ts: new Date(T0 + 60000).toISOString(), inputs: ['T16', 'T17', 'T18'].map((i) => inp(i, 'alex')), items: ['T16', 'T17', 'T18'].map((i) => item(i)), posts: [tpost(ans)] },
      ],
      posts: [{ channel_id: 'C2', message: brief, create_at: T0 + 6000 }, { channel_id: 'C2', root_id: 'p-T16', message: ans, create_at: T0 + 61000 }],
    });
    expect(r.briefs).toEqual([{ id: 'T16', expect: 'joiner_brief', seen: true }]);
    expect(r.bursts[0].answered_once).toBe(true);
    expect(r.unattributed).toEqual([]);
  });
});

describe('brief attempts', () => {
  it('a failed brief (silence, trigger room_join) on a joiner\'s first message is not that message\'s decision', () => {
    const ans = 'Good ideas, Alex. A weekday evening was chosen.';
    const r = build({
      cases: [['T16', 0]],
      lines: [
        { room_id: 'R2', kind: 'silence', trigger: 'room_join', inputs: [inp('T16', 'alex')], items: [item('T16', { job: 'none', verdict: null, brief_for: 'alex' })], error: 'joiner: brief_model_error: 400' },
        { room_id: 'R2', inputs: [inp('T16', 'alex')], items: [item('T16')], posts: [tpost(ans)] },
      ],
      posts: [{ channel_id: 'C2', root_id: 'p-T16', message: ans, create_at: T0 + 30000 }],
    });
    expect(r.cases[0].rules.P1).toEqual({ status: 'pass', reason: 'job A' });
    expect(r.briefs).toEqual([{ id: 'T16', expect: 'joiner_brief', seen: false }]);
  });
});

describe('quiet, routing and matching rules', () => {
  it('a late thread reply to a quiet case fails it, even after the next case started', () => {
    const r = build({
      cases: [['T15', 0], ['T05', 60000]],
      lines: [{ kind: 'silence', inputs: [inp('T15', 'priya')], items: [item('T15', { job: 'none', verdict: null })] }],
      posts: [{ root_id: 'p-T15', message: 'Not for me, thanks', create_at: T0 + 90000 }],
    });
    const t15 = r.cases.find((c) => c.id === 'T15')!;
    expect(t15.rules.P1.status).toBe('fail');
    expect(t15.rules.P4.status).toBe('fail');
    expect(t15.rules.P5.status).toBe('fail'); // posted, but the trace said silence
  });
  it('a quiet case with no trace line but nothing posted passes, flagged trace_missing', () => {
    const r = build({ cases: [['T15', 0]], lines: [], posts: [] });
    expect(r.cases[0].pass).toBe(true);
    expect(r.cases[0].flags.trace_missing).toBe(true);
  });
  it('"covered" on a quiet, B or D case is confident wrong (Kash, 31 Oct)', () => {
    const r = build({
      cases: [['T14', 0]],
      lines: [{ inputs: [inp('T14', 'kash')], items: [item('T14', { job: 'B' })], posts: [tpost('Noted.')] }],
      posts: [{ root_id: 'p-T14', message: 'Noted.', create_at: T0 + 30000 }],
    });
    expect(r.summary.confident_wrong).toBe(1);
    expect(r.summary.diagnostics.covered_on_other).toBe(1);
  });
  it('a project clash that names the decision in public fails P4', () => {
    const desk = 'Rowan wants one agency; that clashes with D2.';
    const pub = 'That clashes with D2, so no.';
    const r = build({
      cases: [['T12', 0]],
      lines: [{ inputs: [inp('T12', 'rowan')], items: [item('T12', { job: 'D', verdict: null, restriction: 'project', clashes_with: 'D2' })], posts: [tpost(desk, 'owner_private'), tpost(pub)] }],
      posts: [{ channel_id: 'DESK', message: desk, create_at: T0 + 20000 }, { root_id: 'p-T12', message: pub, create_at: T0 + 21000 }],
    });
    expect(r.cases[0].rules.P4).toEqual({ status: 'fail', reason: 'public reply carries the details: D2' });
  });
  it('matches a body with a trust annotation appended, but not another sender', () => {
    const ok = build({ cases: [['T05', 0]], lines: [{ kind: 'silence', inputs: [inp('T05', 'Rowan', ' [trust: ok]')], items: [item('T05', { job: 'none', verdict: null })] }], posts: [] });
    expect(ok.cases[0].decision_id).toBe('d0');
    const other = build({ cases: [['T05', 0]], lines: [{ kind: 'silence', inputs: [inp('T05', 'sam')], items: [item('T05', { job: 'none', verdict: null })] }], posts: [] });
    expect(other.cases[0].flags.trace_missing).toBe(true);
  });
  it('a post outside every thread and every trace line is unattributed and breaks the window', () => {
    const r = build({ cases: [['T15', 0]], lines: [], posts: [{ message: 'Random top-level note', create_at: T0 + 5000 }] });
    expect(r.unattributed).toHaveLength(1);
    expect(r.cases[0].pass).toBe(false);
  });
  it('a "D2" check is a whole word, not a substring', () => {
    const desk = 'Clash with record id2x only.';
    const r = build({
      cases: [['T12', 0]],
      lines: [{ inputs: [inp('T12', 'rowan')], items: [item('T12', { job: 'D', verdict: null, restriction: 'project', clashes_with: 'D2' })], posts: [tpost(desk, 'owner_private'), tpost('Thanks, passed to Kash.')] }],
      posts: [{ channel_id: 'DESK', message: desk, create_at: T0 + 20000 }, { root_id: 'p-T12', message: 'Thanks, passed to Kash.', create_at: T0 + 21000 }],
    });
    expect(r.cases[0].rules.P4.reason).toBe("owner-desk post doesn't name D2");
  });
});

describe('P3 for reopen and parked-recall (Kash, 3 Nov)', () => {
  const recall = 'Parked for phase 2: QuickBooks sync, raised by Rowan (roadmap.md §1).';
    it('a parked-recall citing a verified, shown source passes P3', () => {
    const r = build({
      cases: [['T22', 0]],
      lines: [{ inputs: [inp('T22', 'kash')], items: [item('T22', { verdict: 'parked-recall', sources: [{ ref: 'roadmap.md §1', quote: 'Two of the 12 interviewed agencies use it' }] })], posts: [tpost(recall)] }],
      posts: [{ root_id: 'p-T22', message: recall, create_at: T0 + 30000 }],
    });
    expect(r.cases[0].rules.P3).toEqual({ status: 'pass', reason: 'roadmap.md §1: resolves, quote verified, shown in the reply' });
  });
  it('a parked-recall with no sources fails P3', () => {
    const r = build({
      cases: [['T22', 0]],
      lines: [{ inputs: [inp('T22', 'kash')], items: [item('T22', { verdict: 'parked-recall' })], posts: [tpost(recall)] }],
      posts: [{ root_id: 'p-T22', message: recall, create_at: T0 + 30000 }],
    });
    expect(r.cases[0].rules.P2.status).toBe('pass');
    expect(r.cases[0].rules.P3).toEqual({ status: 'fail', reason: 'no sources cited' });
  });
  it('a parked-recall whose quote is not in the source fails P3', () => {
    const bare = 'Parked for phase 2: QuickBooks sync, raised by Rowan.';
    const r = build({
      cases: [['T22', 0]],
      lines: [{ inputs: [inp('T22', 'kash')], items: [item('T22', { verdict: 'parked-recall', sources: [{ ref: 'roadmap.md §1', quote: 'phase 2 roadmap item that is not in the doc' }] })], posts: [tpost(bare)] }],
      posts: [{ root_id: 'p-T22', message: bare, create_at: T0 + 30000 }],
    });
    expect(r.cases[0].rules.P3).toEqual({ status: 'fail', reason: 'roadmap.md §1: quote not in source' });
  });
  it('a reopen whose citation is shown only in the owner desk passes P3', () => {
    const desk = 'Rowan asks to reopen D1 (pilot-plan.md §2): Northbank cannot do a weekday slot.';
    const pub = 'Thanks Rowan, I have passed this to Kash.';
    const r = build({
      cases: [['T21', 0]],
      lines: [{ inputs: [inp('T21', 'rowan')], items: [item('T21', { verdict: 'reopen', sources: [{ ref: 'pilot-plan.md §2', quote: 'Onboarding calls on weekdays, Tue to Thu' }] })], posts: [tpost(desk, 'owner_private'), tpost(pub)] }],
      posts: [{ channel_id: 'DESK', message: desk, create_at: T0 + 20000 }, { root_id: 'p-T21', message: pub, create_at: T0 + 21000 }],
    });
    expect(r.cases[0].rules.P3.reason).toMatch(/^pilot-plan\.md §2: resolves/);
  });
  it('a reopen with no sources fails P3', () => {
    const r = build({
      cases: [['T21', 0]],
      lines: [{ inputs: [inp('T21', 'rowan')], items: [item('T21', { verdict: 'reopen' })], posts: [tpost('Passed to Kash.', 'owner_private'), tpost('Thanks Rowan.')] }],
      posts: [{ channel_id: 'DESK', message: 'Passed to Kash.', create_at: T0 + 20000 }, { root_id: 'p-T21', message: 'Thanks Rowan.', create_at: T0 + 21000 }],
    });
    expect(r.cases[0].rules.P3).toEqual({ status: 'fail', reason: 'no sources cited' });
  });
});

describe('cost', () => {
  it('prices a joined model id at the dearest component (upper bound)', async () => {
    const { priceOf } = await import('./score.ts');
    expect(priceOf('claude-opus-5-5+claude-haiku-5-5')).toEqual({ input: 4, output: 20, cache_read: 0.2, cache_write: 5 });
    expect(priceOf('claude-haiku-5-5')!.input).toBe(0.1);
    expect(priceOf('claude-opus-5-5+mystery')).toBeNull();
  });
});

describe('flags', () => {
  it('parses the run flags', () => {
    const a = parseArgs(['--fast', '--only', 'T05,T08', '--set', 'redteam', '--keep']);
    expect(a).toMatchObject({ fast: true, only: ['T05', 'T08'], set: 'redteam', keep: true, rescore: null });
    expect(() => parseArgs(['--best-of', '3'])).toThrow(/unknown flag/);
  });
});

describe('the agent writes room documents (its Decision log)', () => {
  const line = "Logged as decided: Fieldnote goes first for onboarding. Date: Tue 24 Nov. (Kash's call.)";
  const t14 = (extraPosts: Partial<MmPost>[]) => build({
    cases: [['T14', 0]],
    lines: [{ inputs: [inp('T14', 'kash')], items: [item('T14', { job: 'B', verdict: 'decision' })], posts: [tpost(line)], error: 'decision log: L1 added (create_room_document)' }],
    posts: [{ root_id: 'p-T14', message: line, create_at: T0 + 30000 }, ...extraPosts],
  });
  it("Switch's own notice for the write is not counted as an agent reply, and is reported apart", () => {
    const r = t14([{ id: 'n1', root_id: '', message: '📄 created room document “Decision log”.', create_at: T0 + 30500 }, { id: 'n0', message: '📄 created room document “Channel archive”.', create_at: T0 - 5000 }]);
    const c = r.cases.find((x) => x.id === 'T14')!;
    expect(c.rules.P4.status).toBe('pass');
    expect(c.rules.P5.status).toBe('pass');
    expect(r.summary.diagnostics.switch_doc_notices).toEqual({ before_t0: 1, during_run: 1 });
    expect(r.switch_doc_notices.map((p) => p.post_id)).toEqual(['n1', 'n0']);
  });
  it('an agent post that only looks like a notice is still a post', () => {
    const r = t14([{ id: 'x1', root_id: '', message: '📄 created room document “Decision log”. Also, I decided something.', create_at: T0 + 30500 }]);
    expect(r.cases.find((x) => x.id === 'T14')!.rules.P5.status).toBe('fail');
  });
  it('a cited Decision log row resolves only against the log captured from Switch for that run', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { renderLog } = await import('../src/agent/decision-log.ts');
    const dir = mkdtempSync(join(tmpdir(), 'ck-switch-docs-'));
    mkdirSync(join(dir, ROOM), { recursive: true });
    writeFileSync(join(dir, ROOM, 'decision-log.md'), renderLog('x', [{ id: 'L1', decision: 'Fieldnote goes first for onboarding', why: '', decided_by: 'Kash', decided: '2026-11-04', action_owner: '', due: '2026-11-24', reopen_if: '', source: 'sw_1', raised_by: 'Kash' }], new Date(0)));
    expect(loadRoomContent(ROOT, ROOM).sections.has('decision-log.md §1')).toBe(false);
    const withLog = loadRoomContent(ROOT, ROOM, join(dir, ROOM));
    expect(withLog.sections.get('decision-log.md §1')).toContain('| L1 | confirmed | Fieldnote goes first for onboarding |');
    expect(withLog.sections.get('product.md §2')).toBe(loadRoomContent(ROOT, ROOM).sections.get('product.md §2')); // seeded docs unchanged
  });
});
