// The §10b robustness checks (eval/robustness.ts) on hand-made captures: each passes on the behaviour
// the plan asks for and fails, with a reason, on the behaviour it guards against. No server, no model.
import { describe, expect, it } from 'vitest';
import type { TraceLine } from '../src/shared/trace.ts';
import { parseArgs } from './cli.ts';
import type { MmRawPost } from './mattermost.ts';
import { checkR2, checkR3, checkR4, checkR5, checkR6, checkR7a, checkR7b, checkR8, robustnessFactRows, robustnessMarkdown, traceCost, type RCapture } from './robustness.ts';
import { whichChecks } from './robustness-live.ts';

const BOT = 'bot';
const CH = 'ch';
const DESK = 'desk';
const T = Date.parse('2026-11-04T10:00:00Z');
const at = (s: number) => T + s * 1000;

let n = 0;
const line = (o: Partial<TraceLine> & { inputs: string[] }): TraceLine => ({
  schema: 'ck.trace/1', ts: new Date(o.ts ? Date.parse(o.ts) : at(++n)).toISOString(), decision_id: `d${n}`, room_id: 'R', room_name: 'r',
  kind: 'reply', trigger: 'message', burst: null, model: null, error: null, posts: [], items: [],
  ...o,
  inputs: o.inputs.map((b, i) => ({ message_id: `in-${b.slice(0, 8)}-${i}`, sender: 'rowan', body: b, received_at: new Date(T).toISOString() })),
} as TraceLine);
const pub = (event_id = 'e1') => ({ route: 'public_thread' as const, room_id: 'R', room_name: 'r', thread_id: null, event_id, body: 'x' });
const desk = (event_id = 'e9') => ({ route: 'owner_private' as const, room_id: 'D', room_name: 'r-desk', thread_id: null, event_id, body: 'x' });
const item = (verdict: string | null, job = 'A') => ({ message_id: 'm', job, verdict, restriction: null, clashes_with: null, sources: [{ ref: 'pilot-plan.md §2', quote: 'q' }], decision_record: null, brief_for: null }) as TraceLine['items'][number];
const post = (id: string, message: string, create_at: number, o: Partial<MmRawPost> = {}): MmRawPost => ({ id, channel_id: CH, user_id: BOT, root_id: '', message, type: '', create_at, ...o });

function cap(o: Partial<RCapture>): RCapture {
  return { bot: BOT, agentName: 'context-keeper-eval', channel: CH, desk: DESK, trace: [], posts: [], cases: {}, marks: {}, agentLog: '', ...o };
}
const B1 = { T01: 'Back! Lots of ideas. First: reminders?', T02: 'Also direct debit.', T03: 'And receipts.' };
const b1cases = { T01: { post_id: 'p1', create_at: at(0), body: B1.T01 }, T02: { post_id: 'p2', create_at: at(8), body: B1.T02 }, T03: { post_id: 'p3', create_at: at(14), body: B1.T03 } };

describe('R2 restart mid-burst', () => {
  it('passes on one combined reply, no duplicates, one brief', () => {
    const r = checkR2(cap({
      cases: b1cases,
      trace: [line({ kind: 'brief', inputs: [B1.T01], posts: [pub('b')] }), line({ inputs: [B1.T02, B1.T03, B1.T01], posts: [pub('r')], items: [item('covered')] })],
      posts: [post('a1', '👋 **Welcome back, Rowan** · …', at(20), { root_id: 'p1' }), post('a2', 'Reminders exist…', at(60), { root_id: 'p2' })],
      agentLog: 're-queued 1 message(s) from before the restart',
    }), ['T01', 'T02', 'T03']);
    expect(r.status).toBe('pass');
    expect(r.evidence.join('\n')).toContain("landed in T02's thread");
  });

  it('fails when the restart loses the brief and splits the burst', () => {
    const r = checkR2(cap({
      cases: b1cases,
      trace: [line({ inputs: [B1.T01], posts: [pub('r1')] }), line({ inputs: [B1.T02, B1.T03], posts: [pub('r2')] })],
      posts: [post('a1', 'one', at(30), { root_id: 'p1' }), post('a2', 'two', at(60), { root_id: 'p2' })],
    }), ['T01', 'T02', 'T03']);
    expect(r.status).toBe('fail');
    const fails = r.evidence.filter((e) => e.startsWith('FAIL'));
    expect(fails.some((e) => /2 decision line/.test(e))).toBe(true);
    expect(fails.some((e) => /returner brief: 0/.test(e))).toBe(true);
  });

  it('fails on a duplicate post', () => {
    const r = checkR2(cap({
      cases: b1cases,
      trace: [line({ kind: 'brief', inputs: [B1.T01], posts: [pub('b')] }), line({ inputs: [B1.T01, B1.T02, B1.T03], posts: [pub('r')] })],
      posts: [post('a0', '👋 hi', at(20), { root_id: 'p1' }), post('a1', 'same', at(60), { root_id: 'p1' }), post('a2', 'same', at(61), { channel_id: CH })],
    }), ['T01', 'T02', 'T03']);
    expect(r.status).toBe('fail');
    expect(r.evidence.some((e) => /duplicate agent posts/.test(e))).toBe(true);
  });
});

describe('R3 own posts ignored', () => {
  it('passes when no input is an agent post, fails on an input with our event id or body', () => {
    const base = { posts: [post('a1', 'Reminders exist since v0.6.', at(5))] };
    expect(checkR3(cap({ ...base, trace: [line({ inputs: ['why not reminders?'], posts: [pub('ev1')] })] })).status).toBe('pass');
    const byBody = checkR3(cap({ ...base, trace: [line({ inputs: ['Reminders exist since v0.6.'] })] }));
    expect(byBody.status).toBe('fail');
    const l = line({ inputs: ['something'], posts: [pub('ev1')] });
    const echo = line({ inputs: ['x'] });
    echo.inputs[0].message_id = 'ev1';
    expect(checkR3(cap({ ...base, trace: [l, echo] })).status).toBe('fail');
  });
  it('is not a pass on an empty run', () => expect(checkR3(cap({})).status).toBe('fail'));
});

describe('R4 fail quiet', () => {
  const T05 = { T05: { post_id: 'p5', create_at: at(0), body: 'Saturdays?' } };
  it('passes: owner note first, nothing public, the retry replies 60 s later with the right verdict', () => {
    const r = checkR4(cap({
      cases: T05,
      trace: [line({ ts: new Date(at(20)).toISOString(), kind: 'owner_note', inputs: ['Saturdays?'], posts: [desk()], error: 'model_error(retryable): injected fault: model_500 (CK_FAULT)' }),
        line({ ts: new Date(at(90)).toISOString(), inputs: ['Saturdays?'], posts: [pub()], items: [item('covered')] })],
      posts: [post('n1', "Couldn't check this one: message …", at(21), { channel_id: DESK }), post('r1', 'Weekdays, because…', at(90), { root_id: 'p5' })],
    }), 'T05', 'covered');
    expect(r.status).toBe('pass');
  });
  it('fails when the fault never fired and the first decision replied', () => {
    const r = checkR4(cap({ cases: T05, trace: [line({ inputs: ['Saturdays?'], posts: [pub()], items: [item('covered')] })], posts: [post('r1', 'Weekdays', at(20), { root_id: 'p5' })] }), 'T05', 'covered');
    expect(r.status).toBe('fail');
  });
});

describe('R5 retract', () => {
  it('fails, with reasons, when nothing reads "wrong"', () => {
    const r = checkR5(cap({
      cases: { T05: { post_id: 'p5', create_at: at(0), body: 'Saturdays?' }, WRONG: { post_id: 'w', create_at: at(100), body: 'wrong' } },
      marks: { wrong_at: at(100) }, trace: [line({ kind: 'silence', inputs: ['wrong'], items: [item(null, 'none')] })],
    }), 'T05', 0, 0);
    expect(r.status).toBe('fail');
    expect(r.evidence.filter((e) => e.startsWith('FAIL'))).toHaveLength(3);
  });
  it('passes on a correction, a retracted line and a new misses entry', () => {
    const r = checkR5(cap({
      cases: { T05: { post_id: 'p5', create_at: at(0), body: 'Saturdays?' } }, marks: { wrong_at: at(100) },
      trace: [line({ inputs: ['wrong'], error: 'retracted d1' })], posts: [post('c', 'Correction: …', at(110), { root_id: 'p5' })],
    }), 'T05', 0, 1);
    expect(r.status).toBe('pass');
  });
});

describe('R6 pending items survive', () => {
  const base = { cases: { T12: { post_id: 'p12', create_at: at(0), body: 'One is plenty.' }, ANSWER: { post_id: 'ans', create_at: at(200), body: '#1 plan stands', channel: DESK } }, marks: { restarted_at: at(100), answer_at: at(200) } };
  it('passes when the ruling lands in the thread after the restart', () => {
    const r = checkR6(cap({ ...base, posts: [post('n', '⚖️ **#1 · Clash to rule on** · …', at(20), { channel_id: DESK }), post('l', 'Flagged to the owner…', at(21), { root_id: 'p12' }), post('u', 'Update from Kash: The plan stands.', at(205), { root_id: 'p12' })] }), 'T12');
    expect(r.status).toBe('pass');
  });
  it('fails when the restart forgot the item', () => {
    const r = checkR6(cap({ ...base, posts: [post('n', '⚖️ **#1 · Clash to rule on** · …', at(20), { channel_id: DESK }), post('l', 'Flagged…', at(21), { root_id: 'p12' })] }), 'T12');
    expect(r.status).toBe('fail');
  });
});

describe('R7 (adapted)', () => {
  const LIMIT = 'limit!';
  const L = Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`L${i}`, { post_id: `l${i}`, create_at: at(i * 30), body: `message ${i}` }]));
  const decided = [1, 2, 3].map((i) => line({ inputs: [`message ${i}`], posts: [pub(`e${i}`)] }));
  const replies = [1, 2, 3].map((i) => post(`r${i}`, `reply ${i}`, at(i * 30 + 20), { root_id: `l${i}` }));
  const log = 'demo_limit: Rowan in r (told once)\ndemo_limit: Rowan in r (silent)\n';
  it('R7a passes: three answered, the limit line once, then silence, both gated messages seen', () => {
    expect(checkR7a(cap({ cases: L, trace: decided, posts: [...replies, post('x', LIMIT, at(140), { root_id: 'l4' })], agentLog: log }), Object.keys(L), 3, LIMIT).status).toBe('pass');
  });
  it('R7a fails when the 5th also gets the limit line, or a gated message was decided', () => {
    expect(checkR7a(cap({ cases: L, trace: decided, posts: [...replies, post('x', LIMIT, at(140), { root_id: 'l4' }), post('y', LIMIT, at(170), { root_id: 'l5' })], agentLog: log }), Object.keys(L), 3, LIMIT).status).toBe('fail');
    expect(checkR7a(cap({ cases: L, trace: [...decided, line({ inputs: ['message 5'] })], posts: [...replies, post('x', LIMIT, at(140), { root_id: 'l4' })], agentLog: log }), Object.keys(L), 3, LIMIT).status).toBe('fail');
  });
  it('R7a counts only replied messages toward the limit (a silent decision does not use one up)', () => {
    const quiet = [line({ inputs: ['message 1'], kind: 'silence' }), ...decided.slice(1), line({ inputs: ['message 4'], posts: [pub('e4')] })];
    const posts = [...replies.slice(1), post('r4', 'reply 4', at(140), { root_id: 'l4' }), post('x', LIMIT, at(170), { root_id: 'l5' })];
    expect(checkR7a(cap({ cases: L, trace: quiet, posts, agentLog: 'demo_limit: Rowan in r (told once)\n' }), Object.keys(L), 3, LIMIT).status).toBe('pass');
  });

  const PAUSED = 'paused';
  const Q = Object.fromEntries([1, 2, 3].map((i) => [`Q${i}`, { post_id: `q${i}`, create_at: at(i * 30), body: `q ${i}` }]));
  const notes = [post('w', '💸 **Spend at 80%** · …', at(40), { channel_id: DESK }), post('c', '⏸️ **Daily spend cap reached** · …', at(41), { channel_id: DESK })];
  const opus = { id: 'claude-opus-5-5', calls: 1, input_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 1, latency_ms: 1 };
  const ok = { cases: Q, marks: { metered_calls: 1 }, posts: [...notes, post('p', PAUSED, at(70), { root_id: 'q2' })] };
  it('R7b passes: both notes once, one metered call, the paused line once, then silence', () => {
    expect(checkR7b(cap(ok), ['Q1', 'Q2', 'Q3'], PAUSED).status).toBe('pass');
  });
  it('R7b: Q1 answered from the call already in flight when the cap was hit is reported, not failed', () => {
    const r = checkR7b(cap({ ...ok, trace: [{ ...line({ ts: new Date(at(42)).toISOString(), inputs: ['q 1'], posts: [pub()] }), model: opus }], posts: [...ok.posts, post('a', 'Flagged…', at(42), { root_id: 'q1' })] }), ['Q1', 'Q2', 'Q3'], PAUSED);
    expect(r.status).toBe('pass');
    expect(r.evidence.at(-1)).toMatch(/Q1 \(its call crossed the cap\): reply .*1 public post/);
  });
  it('R7b fails on a model call after the cap: a later message decided, or a second metered call', () => {
    expect(checkR7b(cap({ ...ok, trace: [{ ...line({ ts: new Date(at(95)).toISOString(), inputs: ['q 3'] }), model: opus }] }), ['Q1', 'Q2', 'Q3'], PAUSED).status).toBe('fail');
    expect(checkR7b(cap({ ...ok, marks: { metered_calls: 2 } }), ['Q1', 'Q2', 'Q3'], PAUSED).status).toBe('fail');
  });
});

describe('R8 missed while down', () => {
  const base = { cases: { T08: { post_id: 'p8', create_at: at(10), body: 'Dark mode?' } }, marks: { stopped_at: at(0), started_at: at(20) } };
  it('passes on one reply after the restart; the late marker is reported, not scored', () => {
    const r = checkR8(cap({ ...base, trace: [line({ inputs: ['Dark mode?'], posts: [pub()] })], posts: [post('r', 'New idea, thanks Rowan', at(60), { root_id: 'p8' })] }), 'T08');
    expect(r.status).toBe('pass');
    expect(r.evidence).toContain('marked late: no (not built)');
  });
  it('fails when the message is never answered', () => {
    expect(checkR8(cap({ ...base }), 'T08').status).toBe('fail');
  });
});

describe('report', () => {
  it('cost from trace lines; markdown and fact rows name every check', () => {
    const l = { ...line({ inputs: ['a'] }), model: { id: 'claude-opus-5-5', calls: 2, input_tokens: 1_000_000, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, latency_ms: 1 } };
    expect(traceCost([l])).toEqual({ calls: 2, usd: 4 });
    const report = {
      schema: 'ck.robustness/1' as const, run_id: 'r1', model: 'claude-opus-5-5', reviewer_model: null, started_at: new Date(T).toISOString(), ended_at: new Date(T).toISOString(),
      results: [checkR8(cap({}), 'T08'), { ...checkR3(cap({})), status: 'pass' as const }], cost: { trace_usd: 1, trace_calls: 2, metered_usd: 1.5, metered_calls: 3, note: '' }, incidents: [], versions: { sha: null, switch: null, mattermost: null },
    };
    const md = robustnessMarkdown(report, 'testset/results/x.json');
    expect(md).toContain('1/2 pass');
    expect(md).toContain('R8 adapted');
    const rows = robustnessFactRows(report, 'npm run eval -- --robustness', 'abc1234', 'x.json');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toContain('| fail |');
  });
});

describe('flags', () => {
  it('--robustness alone means every check; a list picks some', () => {
    expect(parseArgs(['--robustness']).robustness).toBe('all');
    expect(parseArgs(['--robustness', '--keep']).robustness).toBe('all');
    expect(parseArgs(['--robustness', 'R2,R7']).robustness).toBe('R2,R7');
    expect(whichChecks('all')).toHaveLength(8);
    expect(whichChecks('r2, R7')).toEqual(['R2', 'R7']);
    expect(() => whichChecks('R9')).toThrow(/no check R9/);
  });
});
