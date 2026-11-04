// handoff/dispatch: the glue between the live listener (src/agent/main.ts) and job E's chain, kept
// here so the offline tests run it without a Switch connection.
//   toHandoffMsg()   a Switch message event → the chain's message shape
//   noteNewIdeas()   after a job A decision: each genuinely new idea goes on the owner's list, and so
//                    does a might-be-related one whose reply told the raiser the new part is logged
//                    ("builds on <ref>"; Kash, 4 Nov)
//   isAgentSender()  another agent's post (Claude Code's, say) is never a proposal for job A (PR11)
import type { TraceItem, TraceLine } from '../../shared/trace.ts';
import type { Input, ModelReply } from '../pipeline.ts';
import type { HandoffChain, HandoffMsg } from './chain.ts';
import type { Source } from './store.ts';
import { replyLogsIt } from './text.ts';
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

/** Builds on something in the record, partly new: job A itself chose might-be-related (not a gate or
 *  reviewer downgrade), the cited record survived the quote gate, and its reply logged the new part.
 *  The tool output has no "partly new" field, so the reply is the only signal (replyLogsIt). */
const buildsOn = (it: TraceItem, own: ModelReply | undefined) =>
  it.verdict === 'might-be-related' && it.sources.length > 0 && own?.verdict === 'might-be-related' && replyLogsIt(own.reply);

/** Job A's new ideas in these decisions (and related ones whose new part it logged) → noteIdea
 *  (idempotent per idea). Returns the refs noted. */
export async function noteNewIdeas(chain: ChainLike, roomId: string, roomName: string, inputs: Input[], results: { trace: TraceLine | null; replies?: ModelReply[] }[], handles?: HandleMemo): Promise<string[]> {
  const refs: string[] = [];
  for (const r of results) for (const it of r.trace?.items ?? []) {
    if (it.job !== 'A') continue;
    const related = buildsOn(it, r.replies?.find((x) => x.message_id === it.message_id));
    if (it.verdict !== 'new' && !related) continue;
    const x = inputs.find((i) => i.message_id === it.message_id);
    if (!x) continue;
    const rec = await chain.noteIdea({
      room_id: roomId, room_name: roomName, message_id: x.message_id, sender: x.sender, sender_name: x.sender_name,
      sender_handle: handles?.get(x.message_id) ?? handleFromSender(x.sender), body: x.body, thread_id: x.thread_id ?? null, received_at: x.received_at,
    }, it.sources as Source[], related ? { buildsOn: [...new Set(it.sources.map((s) => s.ref))] } : {});
    refs.push(rec.ref);
  }
  return refs;
}
