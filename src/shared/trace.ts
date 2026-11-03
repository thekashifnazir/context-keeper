// trace: one JSON line per decision (ck.trace/1), silence included. The eval scores these lines
// and never parses prose; the README can show one as the agent's audit log.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

export const VERDICTS = ['covered', 'might-be-related', 'parked', 'new', 'contradicts-record', 'decision', 'reopen', 'parked-recall'] as const;

const Iso = z.string();
const Source = z.object({ ref: z.string(), quote: z.string() });
const Item = z.object({
  message_id: z.string(),
  job: z.enum(['A', 'B', 'D', 'none']),
  verdict: z.enum(VERDICTS).nullable(),
  restriction: z.enum(['personal', 'project', 'not-a-restriction']).nullable(),
  clashes_with: z.string().nullable(),
  sources: z.array(Source),
  decision_record: z.object({ summary: z.string(), owner: z.string(), date: z.string() }).nullable(),
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
