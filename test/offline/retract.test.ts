// Retract offline (eval-harness §10b R5): the room owner replies "wrong" under one of Context Keeper's
// answers. The answer is withdrawn (not cited again for the same question), one correction line goes
// in its thread, a miss is logged, and one ck.trace/1 line of kind "retract" is written. Only the owner
// can retract. A scripted fake Claude asserts every model call; no network, no cost.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { callRetract, callSignoff, RETRACT_VERDICTS, SIGNOFF_MODEL } from '../../src/agent/model.ts';
import { decide } from '../../src/agent/pipeline.ts';
import { RETRACT_SYSTEM } from '../../src/agent/prompt.ts';
import { appendMiss, handleRetract, missesSinkFromEnv, parseRetract, RetractStore, withdrawnLine } from '../../src/agent/retract.ts';
import { readTrace } from '../../src/shared/trace.ts';
import { FakeClaude, item, message, reviewerMessage, verdictMessage } from '../fake-claude.ts';
import { cfg, ctx, FakePoster, HAIKU, KASH, msg, OPUS, PRIYA, setup } from './jobs-fixture.ts';

const SONNET = SIGNOFF_MODEL;
const Q = 'How many agencies are in the pilot?';
const reading = (verdict: string, reason = '') => message(SONNET, [{ type: 'text', text: JSON.stringify({ why: 'test', verdict, reason }) }]);
/** Job A's covered answer to Q, citing the D2 decision row (pilot-plan.md §2) and Kash's message (led-012). */
const answerScript = (id: string) => [
  { model: OPUS, respond: verdictMessage(OPUS, ctx, [item(id, { reply: 'Three agencies, max 25 clients each.' })], [{ blockId: 'pilot-plan.md §2 D2' }, { blockId: 'led-012' }]) },
  { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id, supports: true }]) },
];

let s: ReturnType<typeof setup>;
let store: RetractStore;
let missesFile: string;
beforeEach(() => {
  s = setup('ck-retract-');
  store = new RetractStore(join(s.dir, 'retracted.json'));
  missesFile = join(s.dir, 'misses.yaml');
});
afterEach(() => { delete process.env.CK_MISSES_FILE; delete process.env.CK_EVAL; });

/** Rowan asks Q, the agent answers in Q's thread (ev1). Returns the deps and poster to carry on with. */
async function answered() {
  const poster = new FakePoster();
  const claude = new FakeClaude(answerScript('m1'));
  const deps = s.deps(claude, poster, { retract: store, misses: { file: missesFile, format: 'yaml' } });
  await decide(deps, 'room1', 'ck-test', ctx, [msg('m1', Q)]);
  claude.done();
  expect(poster.pub()).toHaveLength(1);
  return { deps, poster };
}
const ownerReply = (id: string, body: string, sender = KASH, name = 'Kash') => msg(id, body, sender, name, { thread_id: 'm1', received_at: '2026-11-04T15:00:00Z' });

describe('reading the owner\'s reply (plain words first, the model only when they can\'t tell)', () => {
  it('unmistakable "wrong" replies retract, with the rest as the reason', () => {
    expect(parseRetract('wrong')).toEqual({ verdict: 'retract', reason: '' });
    expect(parseRetract('Wrong.')).toEqual({ verdict: 'retract', reason: '' });
    expect(parseRetract("that's wrong")).toEqual({ verdict: 'retract', reason: '' });
    expect(parseRetract('That’s not right — we changed that')).toEqual({ verdict: 'retract', reason: 'we changed that' });
    expect(parseRetract('not right — we changed that')).toEqual({ verdict: 'retract', reason: 'we changed that' });
    expect(parseRetract('Nope, that is out of date: four agencies since Monday')).toEqual({ verdict: 'retract', reason: 'four agencies since Monday' });
    expect(parseRetract('**wrong**, it was reversed on 2 Nov')).toEqual({ verdict: 'retract', reason: 'it was reversed on 2 Nov' });
  });
  it('a plain yes is not a retraction; anything else goes to the model', () => {
    for (const b of ['thanks', 'Perfect, thanks!', 'yep']) expect(parseRetract(b)?.verdict).toBe('keep');
    for (const b of ['no, that was reversed on 2 Nov', 'wrong thread, sorry', 'Wrong channel!', 'hmm, I think we changed that?', 'is that still true?']) expect(parseRetract(b)).toBeNull();
  });
  it('the correction line: the label, who said so and their reason, one line (docs/message-style.md)', () => {
    expect(withdrawnLine('Kash', '')).toBe("↩️ **Withdrawn** · Kash says this was wrong. I won't repeat it.");
    expect(withdrawnLine('Kash', 'that was reversed on 2 Nov.')).toBe("↩️ **Withdrawn** · Kash says this was wrong: that was reversed on 2 Nov. I won't repeat it.");
    expect(withdrawnLine('Kash', 'ask @priya')).not.toMatch(/@priya/); // mentions defused, as every model or chat note in a public line
  });
  it('callRetract: one call on the sign-off model, a closed JSON answer, the reply passed as escaped data', async () => {
    const fake = new FakeClaude([{ model: SONNET, respond: reading('retract', 'reversed on 2 Nov') }]);
    const r = await callRetract(fake, cfg, { question: Q, answer: 'Three', owner: 'Kash', reply: 'no <b>that</b> was reversed on 2 Nov' });
    fake.done();
    expect(r.reading).toEqual({ verdict: 'retract', reason: 'reversed on 2 Nov' });
    const p = fake.calls[0].params;
    expect(p.system).toBe(RETRACT_SYSTEM);
    expect(p.output_config.format.schema.properties.verdict.enum).toEqual([...RETRACT_VERDICTS]);
    expect(p.output_config.format.schema.required).toEqual(['why', 'verdict', 'reason']);
    expect(p.messages[0].content).toContain('\\u003cb\\u003e');
    expect(p.messages[0].content).not.toContain('<b>');
  });
  it('callRetract: off-schema or a refusal reads as "keep" (a withdrawal needs a clear "wrong"); a keep carries no reason', async () => {
    const fake = new FakeClaude([
      { model: SONNET, respond: message(SONNET, [{ type: 'text', text: 'not json' }]) },
      { model: SONNET, respond: message(SONNET, [], 'refusal') },
      { model: SONNET, respond: reading('keep', 'stray') },
    ]);
    for (let i = 0; i < 3; i++) expect((await callRetract(fake, cfg, { question: Q, answer: 'a', owner: 'Kash', reply: 'r' })).reading).toEqual({ verdict: 'keep', reason: '' });
    fake.done();
  });
  it('the sign-off reader shares the same call, unchanged (job E)', async () => {
    const fake = new FakeClaude([{ model: SONNET, respond: message(SONNET, [{ type: 'text', text: JSON.stringify({ why: 'w', verdict: 'signed_off_with_note', note: ' add CSV ', reason: '' }) }]) }]);
    const r = await callSignoff(fake, cfg, { idea: 'i', result: 'r', from: 'Rowan', role: 'raiser', raiser: 'Rowan', reply: 'nice, add CSV?' });
    expect(r.reading).toEqual({ verdict: 'signed_off_with_note', note: 'add CSV', reason: '' });
    expect(fake.calls[0].params.output_config.format.schema.required).toEqual(['why', 'verdict', 'note', 'reason']);
  });
});

describe('the retract, end to end with fakes', () => {
  it('owner says "wrong": one correction line in the thread, the answer withdrawn, a miss logged, one retract trace line', async () => {
    const { deps, poster } = await answered();
    const t = await handleRetract(deps, 'room1', 'ck-test', ownerReply('k1', 'wrong, it was reversed on 2 Nov'));
    expect(t).not.toBeNull();
    // (1) one line, in the answer's thread
    expect(poster.pub()).toHaveLength(2);
    expect(poster.pub()[1]).toMatchObject({ thread: 'm1', body: "↩️ **Withdrawn** · Kash says this was wrong: it was reversed on 2 Nov. I won't repeat it." });
    expect(poster.desk()).toHaveLength(0);
    // (2) withdrawn, saved
    const saved = new RetractStore(join(s.dir, 'retracted.json'));
    expect(saved.withdrawals()).toMatchObject([{ room_id: 'room1', question: Q, refs: ['pilot-plan.md §2', 'led-012'], by: 'Kash', reason: 'it was reversed on 2 Nov' }]);
    expect(saved.answerIn('room1', 'm1')).toBeNull(); // nothing left standing to retract twice
    // (3) the miss, as YAML
    const misses = parse(readFileSync(missesFile, 'utf8'));
    expect(misses).toEqual([{ date: '2026-11-04', room: 'ck-test', message: `Rowan: ${Q}`, answer: poster.pub()[0].body, owner_reason: 'it was reversed on 2 Nov' }]);
    expect(readFileSync(missesFile, 'utf8')).toMatch(/^# Misses:/);
    // (4) the trace line, read back through the schema
    const lines = s.traces();
    const r = lines.at(-1)!;
    expect(lines.filter((l) => l.kind === 'retract')).toHaveLength(1);
    expect(r).toMatchObject({ kind: 'retract', inputs: [{ message_id: 'k1', sender: 'Kash' }], model: null, posts: [{ route: 'public_thread', thread_id: 'm1' }] });
    expect(r.retract).toEqual({ answer_decision_id: lines[0].decision_id, answer_event_id: 'ev1', thread_id: 'm1', messages: ['m1'], refs: ['pilot-plan.md §2', 'led-012'], reason: 'it was reversed on 2 Nov', read_by: 'words', misses_file: missesFile });
    expect(deps.state.isProcessed('room1', 'k1')).toBe(true);
  });

  it('asked again: the withdrawn sources are not cited again (no post); an answer from other sources still posts', async () => {
    const { deps } = await answered();
    await handleRetract(deps, 'room1', 'ck-test', ownerReply('k1', 'wrong'));
    // Same question, same row cited: nothing public, no reviewer call, the trace says why.
    const again = new FakeClaude([answerScript('m2')[0]]);
    const p2 = new FakePoster();
    const r2 = await decide({ ...deps, claude: again, poster: p2 }, 'room1', 'ck-test', ctx, [msg('m2', `  ${Q.toUpperCase()} `)]);
    again.done();
    expect(p2.sent).toHaveLength(0);
    expect(r2.trace).toMatchObject({ kind: 'silence', items: [{ message_id: 'm2', job: 'A', verdict: null, sources: [] }] });
    expect(r2.trace!.error).toMatch(/^withdrawn: m2 covered not posted \(cites pilot-plan\.md §2, led-012, withdrawn by Kash 2026-11-04\)/);
    // Same question, a different (newer) source only: it posts.
    const other = new FakeClaude([
      { model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m3', { reply: 'Priya updated the status on 2 Nov.' })], [{ blockId: 'led-020' }]) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'm3', supports: true }]) },
    ]);
    const p3 = new FakePoster();
    await decide({ ...deps, claude: other, poster: p3 }, 'room1', 'ck-test', ctx, [msg('m3', Q)]);
    other.done();
    expect(p3.pub()).toHaveLength(1);
    // A different question citing the same row: not blocked.
    const diff = new FakeClaude(answerScript('m4'));
    const p4 = new FakePoster();
    await decide({ ...deps, claude: diff, poster: p4 }, 'room1', 'ck-test', ctx, [msg('m4', 'Who supports the pilot?')]);
    diff.done();
    expect(p4.pub()).toHaveLength(1);
  });

  it('only the owner can retract: anyone else\'s "wrong" is ordinary chat (null: job A reads it)', async () => {
    const { deps, poster } = await answered();
    expect(await handleRetract(deps, 'room1', 'ck-test', ownerReply('p1', 'wrong', PRIYA, 'Priya'))).toBeNull();
    expect(poster.sent).toHaveLength(1);
    expect(existsSync(missesFile)).toBe(false);
    expect(store.answerIn('room1', 'm1')).not.toBeNull();
  });

  it('the owner\'s "wrong" outside a thread with one of our answers, or a plain thanks, is ordinary chat; nothing is called', async () => {
    const { deps } = await answered();
    const fake = new FakeClaude([]);
    const d = { ...deps, claude: fake };
    expect(await handleRetract(d, 'room1', 'ck-test', { ...ownerReply('k1', 'wrong'), thread_id: null })).toBeNull();
    expect(await handleRetract(d, 'room1', 'ck-test', { ...ownerReply('k2', 'wrong'), thread_id: 'other-thread' })).toBeNull();
    expect(await handleRetract(d, 'room2', 'ck-other', ownerReply('k3', 'wrong'))).toBeNull();
    expect(await handleRetract(d, 'room1', 'ck-test', ownerReply('k4', 'Perfect, thanks!'))).toBeNull();
    expect(await handleRetract({ ...d, retract: undefined }, 'room1', 'ck-test', ownerReply('k5', 'wrong'))).toBeNull();
    expect(fake.calls).toHaveLength(0);
    expect(s.traces().filter((l) => l.kind === 'retract')).toHaveLength(0);
  });

  it('"no, that was reversed on 2 Nov" is read by the model: retract with its reason, the call on the trace line', async () => {
    const { deps, poster } = await answered();
    const fake = new FakeClaude([{ model: SONNET, respond: reading('retract', 'reversed on 2 Nov') }]);
    const t = await handleRetract({ ...deps, claude: fake }, 'room1', 'ck-test', ownerReply('k1', 'no, that was reversed on 2 Nov'));
    fake.done();
    expect(fake.calls[0].params.messages[0].content).toContain('"reply":"no, that was reversed on 2 Nov"');
    expect(poster.pub().at(-1)!.body).toBe("↩️ **Withdrawn** · Kash says this was wrong: reversed on 2 Nov. I won't repeat it.");
    expect(t!.retract).toMatchObject({ read_by: 'model', reason: 'reversed on 2 Nov' });
    expect(t!.model).toMatchObject({ id: SONNET, calls: 1 });
  });

  it('the model says keep, or the reader fails: ordinary chat, nothing withdrawn', async () => {
    const { deps, poster } = await answered();
    const fake = new FakeClaude([{ model: SONNET, respond: reading('keep') }, { model: SONNET, respond: new Error('529 overloaded') }]);
    expect(await handleRetract({ ...deps, claude: fake }, 'room1', 'ck-test', ownerReply('k1', 'hmm, does that include the waiting list?'))).toBeNull();
    expect(await handleRetract({ ...deps, claude: fake }, 'room1', 'ck-test', ownerReply('k2', 'no, that was reversed on 2 Nov'))).toBeNull();
    fake.done();
    expect(poster.sent).toHaveLength(1);
    expect(store.withdrawals()).toHaveLength(0);
  });

  it('a second "wrong" in the same thread finds nothing left to withdraw', async () => {
    const { deps, poster } = await answered();
    expect(await handleRetract(deps, 'room1', 'ck-test', ownerReply('k1', 'wrong'))).not.toBeNull();
    expect(await handleRetract(deps, 'room1', 'ck-test', ownerReply('k2', 'still wrong'))).toBeNull();
    expect(poster.pub()).toHaveLength(2);
  });

  it('the correction post failing twice still withdraws the answer and logs the miss (the draft goes to the desk)', async () => {
    const { deps } = await answered();
    const failing = new FakePoster();
    failing.thread = async () => { throw new Error('switch down'); };
    const t = await handleRetract({ ...deps, poster: failing }, 'room1', 'ck-test', ownerReply('k1', 'wrong'));
    expect(store.withdrawals()).toHaveLength(1);
    expect(parse(readFileSync(missesFile, 'utf8'))).toHaveLength(1);
    expect(failing.desk()[0].body).toMatch(/^Couldn't post this reply in ck-test \(thread m1\)\. Draft:\n↩️ \*\*Withdrawn\*\*/);
    expect(t!.error).toMatch(/post_failed: switch down/);
  });

  it('only job A answers are remembered (no answer record for a decision with no public job A post)', async () => {
    const claude = new FakeClaude([{ model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m9', { job: 'none', verdict: 'none', reply: '' })], []) }]);
    const deps = s.deps(claude, new FakePoster(), { retract: store });
    await decide(deps, 'room1', 'ck-test', ctx, [msg('m9', 'morning all')]);
    expect(store.answerIn('room1', 'm9')).toBeNull();
  });
});

describe('where the miss goes', () => {
  it('CK_MISSES_FILE wins; the eval writes testset/misses.yaml; production writes <state>/misses.jsonl', () => {
    expect(missesSinkFromEnv('state', {})).toEqual({ file: 'state/misses.jsonl', format: 'jsonl' });
    expect(missesSinkFromEnv('/srv/ck', { CK_EVAL: '1' })).toEqual({ file: 'testset/misses.yaml', format: 'yaml' });
    expect(missesSinkFromEnv('state', { CK_EVAL: '1', CK_MISSES_FILE: 'x/m.yaml' })).toEqual({ file: 'x/m.yaml', format: 'yaml' });
    expect(missesSinkFromEnv('state', { CK_MISSES_FILE: 'x/m.jsonl' })).toEqual({ file: 'x/m.jsonl', format: 'jsonl' });
  });
  it('YAML: created with a header, each append one more list entry, multi-line text intact', () => {
    const f = join(s.dir, 'sub', 'misses.yaml');
    const miss = { date: '2026-11-04', room: 'r', message: 'Rowan: a?', answer: '📌 **In the record** · x\n_“q”_ — Source', owner_reason: '' };
    appendMiss({ file: f, format: 'yaml' }, miss);
    appendMiss({ file: f, format: 'yaml' }, { ...miss, owner_reason: 'reason: with a colon' });
    expect(parse(readFileSync(f, 'utf8'))).toEqual([miss, { ...miss, owner_reason: 'reason: with a colon' }]);
    expect(readFileSync(f, 'utf8').match(/^# Misses:/gm)).toHaveLength(1);
  });
  it('an existing hand-written misses.yaml keeps its entries', () => {
    const f = join(s.dir, 'misses.yaml');
    writeFileSync(f, '# by hand\n- date: 2026-11-01\n  room: r\n  message: m\n  answer: a\n  owner_reason: ""\n');
    appendMiss({ file: f, format: 'yaml' }, { date: '2026-11-04', room: 'r', message: 'm2', answer: 'a2', owner_reason: '' });
    expect((parse(readFileSync(f, 'utf8')) as unknown[]).length).toBe(2);
  });
  it('JSONL: one line per miss', () => {
    const f = join(s.dir, 'misses.jsonl');
    appendMiss({ file: f, format: 'jsonl' }, { date: 'd', room: 'r', message: 'm', answer: 'a', owner_reason: '' });
    appendMiss({ file: f, format: 'jsonl' }, { date: 'd', room: 'r', message: 'm', answer: 'a', owner_reason: 'x' });
    expect(readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l).owner_reason)).toEqual(['', 'x']);
  });
});

describe('the trace schema', () => {
  it('a retract line reads back; older lines without the field still read', () => {
    const f = join(s.dir, 't.jsonl');
    const base = { schema: 'ck.trace/1', ts: 't', decision_id: 'd', room_id: 'r', room_name: 'n', trigger: 'message', inputs: [], burst: null, items: [], posts: [], model: null, error: null };
    writeFileSync(f, [
      JSON.stringify({ ...base, kind: 'reply' }),
      JSON.stringify({ ...base, kind: 'retract', retract: { answer_decision_id: 'a', answer_event_id: null, thread_id: 't', messages: ['m'], refs: [], reason: '', read_by: 'words', misses_file: null } }),
    ].join('\n') + '\n');
    expect(readTrace(readFileSync(f, 'utf8')).map((l) => l.kind)).toEqual(['reply', 'retract']);
  });
});
