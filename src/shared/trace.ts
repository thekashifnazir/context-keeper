// trace: one JSON line per decision (ck.trace/1), silence included. The eval scores these lines
// and never parses prose; the README can show one as the agent's audit log.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

export const VERDICTS = ['covered', 'might-be-related', 'parked', 'new', 'contradicts-record', 'decision', 'reopen', 'parked-recall'] as const;

const Iso = z.string();
const Source = z.object({ ref: z.string(), quote: z.string() });
// Job B's record (agreed with Kash, 3 Nov): who decided is kept apart from who does the work.
// action_owner null = unassigned (never quietly the room owner); due = when the work is due
// (YYYY-MM-DD) or null; reopen_if = what would make it worth revisiting, or null; date = the day it
// was decided (YYYY-MM-DD). decided_by is "" while a teammate's decision waits for the approver.
export const DecisionRecord = z.object({
  summary: z.string(),
  decided_by: z.string(),
  action_owner: z.string().nullable(),
  due: z.string().nullable(),
  reopen_if: z.string().nullable(),
  date: z.string(),
});
export type DecisionRecord = z.infer<typeof DecisionRecord>;
/** Lines written before 3 Nov carry { summary, owner, date }: owner was the action owner or, silently,
 *  the room owner (the two can't be told apart), and date was the due date. Readers see the new shape. */
export function upgradeDecisionRecord(v: unknown): unknown {
  if (!v || typeof v !== 'object' || 'decided_by' in v || !('owner' in v)) return v;
  const o = v as { summary?: unknown; owner?: unknown; date?: unknown };
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  return { summary: str(o.summary), decided_by: '', action_owner: str(o.owner) || null, due: str(o.date) || null, reopen_if: null, date: '' };
}
const Item = z.object({
  message_id: z.string(),
  job: z.enum(['A', 'B', 'D', 'E', 'none']),
  verdict: z.enum(VERDICTS).nullable(),
  restriction: z.enum(['personal', 'project', 'not-a-restriction']).nullable(),
  clashes_with: z.string().nullable(),
  sources: z.array(Source),
  decision_record: z.preprocess(upgradeDecisionRecord, DecisionRecord.nullable()),
  brief_for: z.string().nullable(),
});
const Post = z.object({
  route: z.enum(['public_thread', 'public_top', 'owner_private']),
  room_id: z.string(),
  room_name: z.string(),
  thread_id: z.string().nullable(),
  event_id: z.string().nullable(),
  body: z.string(),
});

// Job E (idea → Claude Code → sign-off): which step of the chain this line records, and the idea's
// state after it. Lines before 5 Nov carried the step in decision_id ("E:<step>:<ref>:<rand>") and
// job 'none'; handoffStep() reads both.
export const HANDOFF_STEPS = [
  'noted', 'approved', 'approval_ignored', 'approval_unmatched', 'approval_duplicate',
  'build_room_created', 'build_room_reused', 'context_posted', 'handed_off', 'handoff_refused', 'announced',
  'room_failed', 'context_failed', 'handoff_failed', 'announce_failed', 'stalled', 'resumed',
  'build_room_chat', 'progress', 'report_unmatched', 'signoff_requested', 'not_done', 'timed_out',
  'signoff_ignored', 'signoff_unclear', 'signed_off', 'reopened',
  'nudged', 'still_building', 'signoff_not_theirs',
] as const;
export type HandoffStep = (typeof HANDOFF_STEPS)[number];
const Handoff = z.object({
  step: z.enum(HANDOFF_STEPS),
  ref: z.string().nullable(), // "I3", or null for a line about no particular idea
  key: z.string().nullable(), // the idempotency key E:<origin room>:<idea message id>
  attempt: z.number().nullable(),
  status: z.string().nullable(), // the idea's status after this step (store.ts Status)
  build_room: z.object({ id: z.string(), name: z.string() }).nullable(),
  target_status: z.string().nullable(), // send_targeted_message's target_statuses for Claude Code
});
export type TraceHandoff = z.infer<typeof Handoff>;

export const TraceLine = z.object({
  schema: z.literal('ck.trace/1'),
  ts: Iso,
  decision_id: z.string(),
  room_id: z.string(),
  room_name: z.string(),
  kind: z.enum(['reply', 'silence', 'brief', 'owner_note']),
  trigger: z.enum(['message', 'room_join']),
  inputs: z.array(z.object({ message_id: z.string(), sender: z.string(), body: z.string(), received_at: Iso })),
  burst: z.object({ size: z.number(), gap_s: z.number(), first_at: Iso, last_at: Iso }).nullable(),
  items: z.array(Item),
  posts: z.array(Post),
  model: z.object({
    id: z.string(), calls: z.number(), input_tokens: z.number(), cache_read_tokens: z.number(),
    cache_write_tokens: z.number(), output_tokens: z.number(), latency_ms: z.number(),
  }).nullable(),
  error: z.string().nullable(),
  /** Job E lines only; absent on every other line (and on job E lines written before 5 Nov). */
  handoff: Handoff.nullable().optional(),
});
export type TraceLine = z.infer<typeof TraceLine>;
export type TraceItem = z.infer<typeof Item>;
export type TracePost = z.infer<typeof Post>;

/** Validate and append one line (written after posting, so event ids are real). Throws on a bad line. */
export function writeTrace(line: TraceLine, file = process.env.CK_TRACE_FILE || 'state/trace.ck.jsonl'): void {
  const ok = TraceLine.parse(line);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(ok) + '\n');
}

/** The job E step a line records: its handoff object, or the old "E:<step>:…" decision id. */
export function handoffStep(line: Pick<TraceLine, 'decision_id' | 'handoff'>): string | null {
  if (line.handoff) return line.handoff.step;
  return line.decision_id.startsWith('E:') ? line.decision_id.split(':')[1] ?? null : null;
}

/** Read a trace file, skipping a torn last line (the process may have died mid-write). */
export function readTrace(text: string): TraceLine[] {
  const out: TraceLine[] = [];
  const lines = text.split('\n').filter(Boolean);
  lines.forEach((l, i) => {
    try {
      out.push(TraceLine.parse(JSON.parse(l)));
    } catch (e) {
      if (i !== lines.length - 1) throw e;
    }
  });
  return out;
}
