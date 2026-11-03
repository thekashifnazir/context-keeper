// capture: everything a run saw, saved so it can be re-scored with no server (--rescore <dir>).
//   capture.json    run facts: rooms, personas, the agent's bot user, each case's post id and time
//   mattermost.json every post read back from the eval rooms and owner desks
//   trace.jsonl     the agent's ck.trace/1 lines (src/shared/trace.ts)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { readTrace, type TraceLine } from '../src/shared/trace.ts';

const Room = z.object({
  room_id: z.string(), // Switch room id (what the trace says)
  room_name: z.string(),
  channel_id: z.string(), // Mattermost channel id (where the visible posts are)
  owner_desk_channel_id: z.string().nullable(),
});

export const CaptureMeta = z.object({
  schema: z.literal('ck.capture/1'),
  run_id: z.string(),
  set: z.enum(['main', 'redteam', 'holdout']),
  mode: z.enum(['real-time', 'fast', 'fixture']),
  model: z.string().nullable(),
  burst_gap_s: z.number(),
  started_at: z.string(),
  t0_ms: z.number(), // setup ended: agent posts before this are pre_replay_posts
  ended_at_ms: z.number(), // the end-of-run sweep finished
  agent: z.object({ name: z.string(), mm_user_id: z.string() }),
  owner_username: z.string(),
  personas: z.record(z.string(), z.string()), // cast name -> Mattermost username
  rooms: z.record(z.string(), Room), // cases.yaml room -> where it ran
  joins: z.array(z.object({ room: z.string(), username: z.string(), at_ms: z.number() })),
  cases: z.array(z.object({ id: z.string(), post_id: z.string(), create_at: z.number() })),
  // Mattermost outages during the run and what the harness did (eval/replay.ts mmRetry); empty when none.
  incidents: z.array(z.string()).optional(),
  versions: z.object({
    harness_sha: z.string().nullable(), agent_sha: z.string().nullable(),
    switch: z.string().nullable(), mattermost: z.string().nullable(),
  }),
});
export type CaptureMeta = z.infer<typeof CaptureMeta>;

export const MmPost = z.object({
  id: z.string(),
  channel_id: z.string(),
  user_id: z.string(),
  root_id: z.string(),
  message: z.string(),
  type: z.string(),
  create_at: z.number(),
});
export type MmPost = z.infer<typeof MmPost>;

export interface Capture {
  meta: CaptureMeta;
  posts: MmPost[];
  trace: TraceLine[];
}

export function loadCapture(dir: string): Capture {
  const need = (f: string) => {
    const p = join(dir, f);
    if (!existsSync(p)) throw new Error(`capture ${dir} has no ${f}`);
    return readFileSync(p, 'utf8');
  };
  const meta = CaptureMeta.parse(JSON.parse(need('capture.json')));
  const posts = z.object({ posts: z.array(MmPost) }).parse(JSON.parse(need('mattermost.json'))).posts;
  const trace = readTrace(existsSync(join(dir, 'trace.jsonl')) ? need('trace.jsonl') : '');
  return { meta, posts, trace };
}
