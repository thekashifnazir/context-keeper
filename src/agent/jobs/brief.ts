// brief (job C): a person's first message after joining the room (Switch's room_join fires just
// before it), or after a long gap (a returner), gets a short personal catch-up in its thread, before
// job A answers the message itself. Kash, 3 Nov: the 3 to 5 things that changed, decisions with who
// and why, what's open, who to talk to; no chit-chat, no blame, nothing from the owner desk; offer
// to talk it through (the voice agent comes later, so tonight that line is a placeholder).
// Built from the room's record only: the model never sees the owner desk or the pending store, and
// every line must carry a quote that is verbatim in the record and that the reviewer accepts.
// Once per person per room; never for the owner. A model error means no brief and no retry storm.
import { randomUUID } from 'node:crypto';
import { writeTrace, type TraceLine } from '../../shared/trace.ts';
import type { RoomContext } from '../blocks.ts';
import { callBrief, type Usage } from '../model.ts';
import type { Deps, Input } from '../pipeline.ts';
import { postBrief } from '../post.ts';
import { toMs, type RoomRecord } from '../room.ts';
import { firstName } from './restriction.ts';

export const RETURN_GAP_DAYS = () => Number(process.env.CK_RETURN_GAP_DAYS ?? 7);

export interface BriefTrigger { kind: 'joiner' | 'returner'; since: string | null }

/** Should this message get a brief first? A room_join seen for the sender, a first-ever message in
 *  the record, or a first message after CK_RETURN_GAP_DAYS of silence. */
export function briefTrigger(deps: Pick<Deps, 'state' | 'ownerSender' | 'selfSenders'>, roomId: string, record: RoomRecord, input: Input): BriefTrigger | null {
  if (deps.selfSenders.has(input.sender)) return null;
  if (deps.ownerSender && input.sender === deps.ownerSender) return null;
  if (deps.state.isBriefed(roomId, input.sender)) return null;
  const now = toMs(input.received_at);
  const before = record.messages.filter((m) => m.author === input.sender_name && m.id !== input.message_id && toMs(m.at) < now);
  const last = before.at(-1);
  if (!last) return { kind: 'joiner', since: null };
  const gapDays = (now - toMs(last.at)) / 86_400_000;
  if (gapDays >= RETURN_GAP_DAYS()) return { kind: 'returner', since: last.at };
  if (deps.state.hasJoined(roomId, input.sender)) return { kind: 'joiner', since: null };
  return null;
}

export const TALK_IT_THROUGH = 'Want to talk it through? A short voice catch-up will be offered here soon.';

export async function runBrief(deps: Deps, roomId: string, roomName: string, ctx: RoomContext, input: Input, trigger: BriefTrigger): Promise<TraceLine> {
  const usages: Usage[] = [];
  const threadId = input.thread_id ?? input.message_id;
  const name = firstName(input.sender_name);
  let error: string | null = null;
  let posts: TraceLine['posts'] = [];
  let sources: { ref: string; quote: string }[] = [];
  deps.state.markBriefed(roomId, input.sender); // one attempt per person per room: no retry storm
  try {
    const { lines, usage } = await callBrief(deps.claude, deps.cfg, deps.system, ctx, { name: input.sender_name, kind: trigger.kind, since: trigger.since, first_message: input.body });
    usages.push(usage);
    const opening = trigger.kind === 'returner' ? `Welcome back, ${name}. Here's what changed while you were away:` : `Welcome, ${name}. A quick catch-up on where things stand:`;
    const r = await postBrief(deps, ctx, { roomId, roomName, threadId, opening, closing: TALK_IT_THROUGH, lines });
    if (r.usage) usages.push(r.usage);
    posts = r.posts;
    sources = r.sources;
    error = [r.error, ...r.events].filter(Boolean).join('; ') || null;
  } catch (e) {
    error = `brief_model_error: ${(e as Error).message}`;
  }
  const line: TraceLine = {
    schema: 'ck.trace/1', ts: new Date().toISOString(), decision_id: randomUUID(), room_id: roomId, room_name: roomName,
    kind: posts.some((p) => p.route !== 'owner_private') ? 'brief' : 'silence', trigger: 'room_join',
    inputs: [{ message_id: input.message_id, sender: input.sender_name, body: input.body, received_at: input.received_at }],
    burst: null,
    items: [{ message_id: input.message_id, job: 'none', verdict: null, restriction: null, clashes_with: null, sources, decision_record: null, brief_for: input.sender_name }],
    posts,
    model: usages.length ? { id: [...new Set(usages.map((u) => u.model))].join('+'), calls: usages.length, input_tokens: usages.reduce((a, u) => a + u.input, 0), cache_read_tokens: usages.reduce((a, u) => a + u.cacheRead, 0), cache_write_tokens: usages.reduce((a, u) => a + u.cacheWrite, 0), output_tokens: usages.reduce((a, u) => a + u.output, 0), latency_ms: usages.reduce((a, u) => a + u.ms, 0) } : null,
    error: error ? `${trigger.kind}: ${error}` : null,
  };
  writeTrace(line, deps.traceFile);
  return line;
}
