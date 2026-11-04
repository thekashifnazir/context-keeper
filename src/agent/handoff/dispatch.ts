// handoff/dispatch: the glue between the live listener (src/agent/main.ts) and job E's chain, kept
// here so the offline tests run it without a Switch connection.
//   toHandoffMsg()   a Switch message event → the chain's message shape
//   noteNewIdeas()   after a job A decision: each genuinely new idea goes on the owner's list, and so
//                    does a might-be-related one where job A named the part the record doesn't have
//                    yet (the trace item's new_part; "builds on <ref>"; Kash, 4 Nov)
//   heardAfterJobA() someone else's chatter in a sign-off thread that job A stayed quiet on → one "noted" line
//   isAgentSender()  another agent's post (Claude Code's, say) is never a proposal for job A (PR11)
import type { TraceItem, TraceLine } from '../../shared/trace.ts';
import type { Input } from '../pipeline.ts';
import type { HandoffChain, HandoffMsg } from './chain.ts';
import type { Source } from './store.ts';
import { handleFromSender } from './wire.ts';

export const isAgentSender = (sender: string) => sender.startsWith('@switch-agent-');

export function toHandoffMsg(roomId: string, roomName: string, m: { message_id: string; sender: string; sender_name?: string | null; body: string; thread_id?: string | null }, who: string, at: string): HandoffMsg {
  return {
    room_id: roomId, room_name: roomName, message_id: m.message_id, sender: m.sender, sender_name: who,
    sender_handle: m.sender_name || handleFromSender(m.sender), body: m.body, thread_id: m.thread_id ?? null, received_at: at,
  };
}

/** Raw chat handles by message id (Switch's sender_name), so a noted idea can add its raiser to the build room. */
export class HandleMemo {
  private m = new Map<string, string>();
  set(messageId: string, handle: string | null | undefined) {
    if (!handle) return;
    this.m.set(messageId, handle);
    if (this.m.size > 2000) this.m.delete(this.m.keys().next().value!);
  }
  get(messageId: string) { return this.m.get(messageId) ?? null; }
}

export interface ChainLike { noteIdea: HandoffChain['noteIdea'] }

/** Builds on something in the record, partly new: the trace item carries new_part only when job A
 *  itself chose might-be-related (not a gate or reviewer downgrade) and named the part the record
 *  doesn't have yet; the cited record must have survived the quote gate. */
const buildsOn = (it: TraceItem) => it.verdict === 'might-be-related' && it.sources.length > 0 && !!it.new_part?.trim();

/** Job A's new ideas in these decisions (and related ones with a new part) → noteIdea
 *  (idempotent per idea). Returns the refs noted. */
export async function noteNewIdeas(chain: ChainLike, roomId: string, roomName: string, inputs: Input[], results: { trace: TraceLine | null }[], handles?: HandleMemo): Promise<string[]> {
  const refs: string[] = [];
  for (const r of results) for (const it of r.trace?.items ?? []) {
    if (it.job !== 'A') continue;
    const related = buildsOn(it);
    if (it.verdict !== 'new' && !related) continue;
    const x = inputs.find((i) => i.message_id === it.message_id);
    if (!x) continue;
    const rec = await chain.noteIdea({
      room_id: roomId, room_name: roomName, message_id: x.message_id, sender: x.sender, sender_name: x.sender_name,
      sender_handle: handles?.get(x.message_id) ?? handleFromSender(x.sender), body: x.body, thread_id: x.thread_id ?? null, received_at: x.received_at,
    }, it.sources as Source[], related ? { buildsOn: [...new Set(it.sources.map((s) => s.ref))], newPart: it.new_part!.trim() } : {});
    refs.push(rec.ref);
  }
  return refs;
}

export interface HeardLike { heard: HandoffChain['heard'] }

/** After a job A decision: a burst from someone other than the raiser or the owner, in an idea's
 *  sign-off thread, that job A posted nothing for gets one "noted" line (chain.heard decides; at most
 *  one per person per idea). One call per thread in the burst. */
export async function heardAfterJobA(chain: HeardLike, roomId: string, roomName: string, inputs: Input[], results: { trace: TraceLine | null }[]): Promise<number> {
  const posted = results.some((r) => r.trace?.posts.some((p) => p.route !== 'owner_private'));
  const lastByThread = new Map<string, Input>();
  for (const x of inputs) if (x.thread_id) lastByThread.set(x.thread_id, x);
  let n = 0;
  for (const x of lastByThread.values()) {
    const ok = await chain.heard({
      room_id: roomId, room_name: roomName, message_id: x.message_id, sender: x.sender, sender_name: x.sender_name,
      body: x.body, thread_id: x.thread_id ?? null, received_at: x.received_at,
    }, posted);
    if (ok) n++;
  }
  return n;
}
