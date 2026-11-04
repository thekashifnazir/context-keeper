// retract: the room owner says one of Context Keeper's public answers was wrong (PREP eval-harness
// §10b R5; build-schedule 10b). Agents never see reactions, so the signal is a reply in the answer's
// thread: "wrong", "that's not right, we changed that", "no, that was reversed on 2 Nov". Only the
// owner (state/owner.json owner_sender, or CK_OWNER_SENDER) can retract; anyone else's "wrong" is
// ordinary chat for job A, and so is an owner reply that doesn't say the answer was wrong.
// Read as the sign-off is (src/agent/handoff/text.ts plainReading, then model.ts callRetract on the
// sign-off model only when the plain words can't tell). On a retraction, in this order:
//   1. the answer is withdrawn (CK_STATE_DIR/retracted.json): for the same question (normalised text),
//      job A won't post an answer that cites any of the same record refs again (post.ts consults it
//      after the quote gate). An answer citing other, newer sources still posts.
//   2. one short correction line in that thread (docs/message-style.md): "↩️ **Withdrawn** · Kash says
//      this was wrong. I won't repeat it."
//   3. a miss entry: CK_MISSES_FILE if set; the eval (CK_EVAL=1) uses testset/misses.yaml; otherwise
//      CK_STATE_DIR/misses.jsonl, so production never writes into the repo.
//   4. one ck.trace/1 line, kind "retract".
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { stringify } from 'yaml';
import { normalise } from '../shared/quote.ts';
import { writeTrace, type TraceLine, type TracePost } from '../shared/trace.ts';
import { PLAIN_YES, plainReading, shortNote } from './handoff/text.ts';
import { callRetract, type Usage } from './model.ts';
import { modelSummary, type Deps, type Input } from './pipeline.ts';
import { sendPublic } from './post.ts';
import { atomicWriteJson } from './state.ts';

// ---- what was answered, and what was withdrawn ---------------------------------------------------

export interface AnswerItem { message_id: string; question: string; asked_by: string; verdict: string | null; refs: string[] }
/** One public job A answer: the thread it went to, its post, and the questions and refs behind it. */
export interface Answer { room_id: string; room_name: string; thread_id: string; decision_id: string; event_id: string | null; body: string; at: string; items: AnswerItem[]; withdrawn?: boolean }
/** One withdrawn answer to one question: those refs aren't cited again for it. */
export interface Withdrawal { room_id: string; question: string; key: string; refs: string[]; by: string; reason: string; at: string; answer_decision_id: string; retract_message_id: string }

interface RetractFile { answers: Answer[]; withdrawn: Withdrawal[] }
const KEEP_ANSWERS = 500;

export class RetractStore {
  private data: RetractFile = { answers: [], withdrawn: [] };
  constructor(private file: string | null) {
    if (file && existsSync(file)) {
      try { this.data = { answers: [], withdrawn: [], ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<RetractFile>) }; } catch { /* unreadable: start clean, never crash */ }
    }
  }
  private save() { if (this.file) atomicWriteJson(this.file, this.data); }

  /** Called by the pipeline after a public job A answer posts. */
  noteAnswer(a: Answer) {
    this.data.answers = [...this.data.answers.filter((x) => !(x.room_id === a.room_id && x.decision_id === a.decision_id)), a].slice(-KEEP_ANSWERS);
    this.save();
  }
  /** The newest answer still standing in this room thread (a thread can hold more than one). */
  answerIn(roomId: string, threadId: string): Answer | null {
    return [...this.data.answers].reverse().find((a) => a.room_id === roomId && a.thread_id === threadId && !a.withdrawn) ?? null;
  }
  /** Saved before anything is posted, so a failed post can't let the answer repeat. */
  withdraw(a: Answer, by: { name: string; message_id: string; at: string }, reason: string): Withdrawal[] {
    const stored = this.data.answers.find((x) => x.room_id === a.room_id && x.decision_id === a.decision_id);
    if (stored) stored.withdrawn = true;
    const out = a.items.map((it): Withdrawal => ({
      room_id: a.room_id, question: it.question, key: normalise(it.question), refs: it.refs, by: by.name, reason, at: by.at,
      answer_decision_id: a.decision_id, retract_message_id: by.message_id,
    }));
    this.data.withdrawn.push(...out);
    this.save();
    return out;
  }
  /** Consulted before job A posts: the same question again, citing a withdrawn ref for it. */
  blocks(roomId: string, question: string, refs: string[]): Withdrawal | null {
    const key = normalise(question);
    return this.data.withdrawn.find((w) => w.room_id === roomId && w.key === key && w.refs.some((r) => refs.includes(r))) ?? null;
  }
  withdrawals(): Withdrawal[] { return [...this.data.withdrawn]; }
}

// ---- reading the owner's reply -------------------------------------------------------------------

// The fast path takes only replies that can't mean anything else: they start "wrong", "that's wrong",
// "not right", "no, that's out of date", "incorrect"… (the rest is the reason). "Wrong thread" and the
// like are not about the answer. A plain yes ("thanks", "perfect") is not a retraction. Anything else
// ("no, that was reversed on 2 Nov", "hmm, I think we changed that") goes to the reader model.
const WRONG = String.raw`(wrong|incorrect|not right|not true|not correct|out of date|outdated|no longer (true|right|correct|the case))`;
const NOT_THE_ANSWER = String.raw`(?!\s+(thread|channel|room|person|one|link|chat|place|window|tab|answer to)\b)`;
const PLAIN_WRONG = new RegExp(String.raw`^\s*[*_~]*(?:(?:no|nope|nah)\b[\s,.!—–-]*)?(?:(?:that|this|it)(?:['’]s| is)\s+)?${WRONG}\b${NOT_THE_ANSWER}`, 'i');

// Plainly not a retraction: the sign-off's plain yes, or a bare thanks.
const THANKS = /^\s*(thanks?( you)?|thx|ta|cheers|nice( one)?|👍|🙏)[\s!.,]*(👍|🙏)?[\s!.]*$/iu;
const PLAIN_KEEP = { test: (b: string) => PLAIN_YES.test(b) || THANKS.test(b) };

/** "retract" with the owner's reason, "keep" (plainly not a retraction), or null: read it with the model. */
export function parseRetract(raw: string): { verdict: 'retract' | 'keep'; reason: string } | null {
  const r = plainReading(raw, PLAIN_WRONG, PLAIN_KEEP);
  return r && { verdict: r.said === 'no' ? 'retract' : 'keep', reason: r.reason };
}

/** The correction line, in the answer's thread. One line: the label, who said so, their reason if any. */
export function withdrawnLine(ownerName: string, reason: string): string {
  const r = shortNote(reason, 200);
  return `↩️ **Withdrawn** · ${ownerName} says this was wrong${r ? `: ${r}` : ''}. I won't repeat it.`;
}

// ---- the misses log ------------------------------------------------------------------------------

export interface MissesSink { file: string; format: 'yaml' | 'jsonl' }
export interface Miss { date: string; room: string; message: string; answer: string; owner_reason: string }

/** CK_MISSES_FILE wins (a .jsonl name is written as JSONL, anything else as YAML); the eval runner
 *  (CK_EVAL=1) writes the test set's testset/misses.yaml; production writes <state>/misses.jsonl. */
export function missesSinkFromEnv(stateDir: string, env: NodeJS.ProcessEnv = process.env): MissesSink {
  const f = env.CK_MISSES_FILE?.trim();
  if (f) return { file: f, format: f.endsWith('.jsonl') ? 'jsonl' : 'yaml' };
  if (env.CK_EVAL === '1') return { file: 'testset/misses.yaml', format: 'yaml' };
  return { file: `${stateDir}/misses.jsonl`, format: 'jsonl' };
}

const MISSES_HEADER = `# Misses: answers the room owner retracted by replying "wrong" (or similar) in the answer's thread.
# Appended by src/agent/retract.ts, one entry per retraction; written only by the eval or when
# CK_MISSES_FILE points here (production keeps its own in <state>/misses.jsonl).
`;

export function appendMiss(sink: MissesSink, miss: Miss): void {
  mkdirSync(dirname(sink.file), { recursive: true });
  if (sink.format === 'jsonl') { appendFileSync(sink.file, JSON.stringify(miss) + '\n'); return; }
  const fresh = !existsSync(sink.file) || !readFileSync(sink.file, 'utf8').trim();
  appendFileSync(sink.file, (fresh ? MISSES_HEADER : '') + stringify([miss], { lineWidth: 0 }));
}

// ---- the retract itself --------------------------------------------------------------------------

/** The owner's thread reply under one of our answers. Returns the trace line when it was a retraction
 *  (handled: nothing else should act on it), or null when it's ordinary chat (job A as usual). */
export async function handleRetract(deps: Deps, roomId: string, roomName: string, input: Input): Promise<TraceLine | null> {
  const store = deps.retract;
  if (!store || !input.thread_id || !deps.ownerSender || input.sender !== deps.ownerSender) return null;
  const answer = store.answerIn(roomId, input.thread_id);
  if (!answer) return null;
  const owner = deps.ownerName || 'Kash';

  let verdict: 'retract' | 'keep';
  let reason: string;
  let usage: Usage | null = null;
  const fast = parseRetract(input.body);
  if (fast) ({ verdict, reason } = fast);
  else {
    try {
      const r = await callRetract(deps.claude, deps.cfg, { question: answer.items.map((i) => i.question).join('\n').slice(0, 1000), answer: answer.body.slice(0, 1500), owner, reply: input.body.slice(0, 1000) });
      ({ verdict, reason } = r.reading);
      usage = r.usage;
    } catch (e) {
      // The reader failed (or the spend cap is on): not a retraction; job A reads it as before.
      console.error(`retract reader failed: ${(e as Error).message}`);
      return null;
    }
  }
  if (verdict !== 'retract') return null;

  // 1. withdrawn first: never repeated, even if what follows fails
  const withdrawn = store.withdraw(answer, { name: owner, message_id: input.message_id, at: input.received_at }, reason);
  deps.state.markProcessed(roomId, [input.message_id]);
  const events: string[] = [`retracted ${answer.decision_id}: ${withdrawn.length} question(s), refs ${[...new Set(withdrawn.flatMap((w) => w.refs))].join(', ') || 'none'}`];

  // 2. the correction line
  const { posts, error: postError } = await sendPublic(deps, roomId, roomName, answer.thread_id, withdrawnLine(owner, reason), events);
  if (postError) events.push(postError);

  // 3. the miss
  const sink = deps.misses ?? null;
  let missesFile: string | null = null;
  if (sink) {
    try {
      appendMiss(sink, {
        date: input.received_at.slice(0, 10), room: roomName,
        message: answer.items.map((i) => `${i.asked_by}: ${i.question}`).join('\n'),
        answer: answer.body, owner_reason: reason,
      });
      missesFile = sink.file;
    } catch (e) { events.push(`misses write failed: ${(e as Error).message}`); }
  }

  // 4. the trace line
  const line: TraceLine = {
    schema: 'ck.trace/1', ts: new Date().toISOString(), decision_id: randomUUID(), room_id: roomId, room_name: roomName,
    kind: 'retract', trigger: 'message',
    inputs: [{ message_id: input.message_id, sender: input.sender_name, body: input.body, received_at: input.received_at }],
    burst: null,
    items: [{ message_id: input.message_id, job: 'none', verdict: null, restriction: null, clashes_with: null, sources: [], decision_record: null, brief_for: null }],
    posts: posts as TracePost[], model: modelSummary(deps.cfg, usage ? [usage] : []), error: events.join('; ') || null,
    retract: {
      answer_decision_id: answer.decision_id, answer_event_id: answer.event_id, thread_id: answer.thread_id,
      messages: answer.items.map((i) => i.message_id), refs: [...new Set(withdrawn.flatMap((w) => w.refs))], reason,
      read_by: fast ? 'words' : 'model', misses_file: missesFile,
    },
  };
  writeTrace(line, deps.traceFile);
  return line;
}
