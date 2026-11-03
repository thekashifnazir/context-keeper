// post: the only way anything reaches a public thread. postPublic() runs, in order:
//   1. the quote gate: every cited block's text (header stripped) must be verbatim in its source
//      (src/shared/quote.ts, the scorer's own rule). A strong verdict with no verified quote drops to
//      might-be-related with the link; with no citation at all it becomes silence + gate_blocked.
//   2. the reviewer (one Haiku call for the decision; sees only each claim and its quotes). A block
//      drops covered / parked / contradicts-record / reopen / parked-recall to might-be-related.
//   3. compose: the model's reply, then the quote and who/when, built by code from verified text.
//   4. idempotency (room + thread + text hash, in state/), then send; a failed send retries once,
//      then the owner desk gets the exact draft.
// Code rules here only ever tighten a verdict, never loosen it.
import { quoteVerified } from '../shared/quote.ts';
import type { TraceItem, TracePost } from '../shared/trace.ts';
import type { RoomContext } from './blocks.ts';
import { callReviewer, type Claude, type ModelConfig, type Usage } from './model.ts';
import { postKey, type AgentState } from './state.ts';
import type { Cited, ModelItem } from './verdict.ts';

export interface Poster {
  /** Post in a room thread; returns the event id. */
  thread(roomId: string, threadId: string | null, body: string): Promise<string | null>;
  /** Post to the owner desk; returns the event id, or null when there's no owner desk. */
  owner(body: string): Promise<string | null>;
  ownerRoom: { id: string; name: string } | null;
}

export const STRONG = new Set(['covered', 'parked', 'contradicts-record', 'reopen', 'parked-recall']);
// Kash, 3 Nov: a genuinely new idea gets a short reply saying it's recorded (CK_ANNOUNCE_NEW=0 turns it off).
const announceNew = () => process.env.CK_ANNOUNCE_NEW !== '0';

export interface Verified { ref: string; quote: string; display: string; who: string; full: string }

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (at: string | null) => (at && /^\d{4}-\d{2}-\d{2}/.test(at) ? `${Number(at.slice(8, 10))} ${MONTH[Number(at.slice(5, 7)) - 1]}` : null);

/** The quote gate for one item: which cited blocks really are verbatim in their source. */
export function gateSources(cited: Cited[], ctx: RoomContext): { verified: Verified[]; refsSeen: string[] } {
  const verified: Verified[] = [];
  const refsSeen: string[] = [];
  for (const c of cited) {
    const b = c.block;
    if (!refsSeen.includes(b.ref)) refsSeen.push(b.ref);
    const quote = c.citedText.startsWith(b.text.slice(0, b.headerLen)) ? c.citedText.slice(b.headerLen) : c.citedText;
    const source = ctx.sourceText.get(b.ref);
    if (!source || !quoteVerified(quote, source)) continue;
    if (verified.some((v) => v.ref === b.ref && v.quote === quote)) continue;
    const day = fmtDay(b.at);
    const where = b.kind === 'message' ? b.ref : b.blockId.replace(/^(\S+ §\d+)\.\d+$/, '$1');
    const who = b.author ? `${b.author}, ${day} (${where})` : `${where}${day ? `, ${day}` : ''}`;
    verified.push({ ref: b.ref, quote, display: b.display, who, full: c.citedText });
  }
  return { verified, refsSeen };
}

function compose(reply: string, sources: Verified[]): string {
  const [first, ...rest] = sources;
  const lines = [reply.trim()];
  if (first) lines.push(`> ${first.display}`, `— ${first.who}`);
  const others = [...new Set(rest.map((s) => s.ref).filter((r) => r !== first?.ref))];
  if (others.length) lines.push(`Also: ${others.join(', ')}`);
  return lines.filter(Boolean).join('\n');
}

export interface PublicDraft {
  roomId: string;
  roomName: string;
  threadId: string | null;
  items: ModelItem[];
}

export interface PublicResult {
  items: TraceItem[];
  posts: TracePost[];
  events: string[]; // gate_blocked, downgrades, duplicate suppression: for the trace's error/notes
  usage: Usage | null; // the reviewer call, if any
  error: string | null;
}

const traceItem = (it: ModelItem, verdict: string | null, sources: Verified[]): TraceItem => ({
  message_id: it.message_id,
  job: it.job,
  verdict: verdict as TraceItem['verdict'],
  restriction: it.restriction as TraceItem['restriction'],
  clashes_with: it.clashes_with,
  sources: sources.map((s) => ({ ref: s.ref, quote: s.quote })),
  decision_record: null,
  brief_for: null,
});

export async function postPublic(
  deps: { claude: Claude; cfg: ModelConfig; poster: Poster; state: AgentState },
  ctx: RoomContext,
  draft: PublicDraft,
): Promise<PublicResult> {
  const events: string[] = [];
  type Plan = { it: ModelItem; verdict: string | null; sources: Verified[]; body: string | null };
  const plans: Plan[] = [];

  // 1. quote gate
  for (const it of draft.items) {
    const { verified, refsSeen } = gateSources(it.cited, ctx);
    let verdict = it.verdict;
    let body: string | null = null;
    if (it.job === 'A' && verdict && (STRONG.has(verdict) || verdict === 'might-be-related')) {
      if (verified.length) {
        body = compose(it.reply, verified);
      } else if (STRONG.has(verdict) && refsSeen.length) {
        events.push(`gate: ${it.message_id} ${verdict}→might-be-related (no verified quote)`);
        verdict = 'might-be-related';
        body = `This might be related: ${refsSeen.join(', ')}.`;
      } else {
        events.push(`gate_blocked: ${it.message_id} ${verdict} had no verified quote`);
        verdict = null;
      }
    } else if (it.job === 'A' && verdict === 'new' && announceNew() && it.reply.trim()) {
      body = it.reply.trim();
    }
    plans.push({ it, verdict, sources: verified, body });
  }

  // 2. reviewer: strong verdicts with verified quotes only
  let usage: Usage | null = null;
  const toReview = plans.filter((p) => p.body && p.verdict && STRONG.has(p.verdict) && p.sources.length);
  if (toReview.length) {
    try {
      const r = await callReviewer(deps.claude, deps.cfg, toReview.map((p) => ({ id: p.it.message_id, claim: p.it.claim || p.it.reply, quotes: p.sources.map((s) => s.full) })));
      usage = r.usage;
      for (const p of toReview) {
        const rv = r.reviews.get(p.it.message_id);
        if (rv?.supports) continue;
        events.push(`reviewer: ${p.it.message_id} ${p.verdict}→might-be-related (${rv?.issue || 'no result'})`);
        p.verdict = 'might-be-related';
        p.body = compose(`This might be related, though I can't confirm it answers your question:`, p.sources);
      }
    } catch (e) {
      // Fail quiet: nothing reaches the room without a passed review.
      events.push(`reviewer_failed: ${(e as Error).message}`);
      for (const p of plans) { p.body = null; if (p.verdict && (STRONG.has(p.verdict) || p.verdict === 'might-be-related')) p.verdict = null; }
      return finish(plans, [], events, usage, `reviewer_failed: ${(e as Error).message}`, false);
    }
  }

  // 3. compose one post per decision (a burst gets one combined reply), 4. idempotent send
  const bodies = plans.filter((p) => p.body).map((p) => p.body!);
  const posts: TracePost[] = [];
  let error: string | null = null;
  if (bodies.length) {
    const body = bodies.join('\n\n');
    const key = postKey(draft.roomId, draft.threadId, body);
    const prior = deps.state.postedEvent(key, draft.roomId);
    if (prior !== undefined) {
      events.push(`duplicate suppressed: ${key}`);
    } else {
      let eventId: string | null = null;
      let sent = false;
      for (let attempt = 0; attempt < 2 && !sent; attempt++) {
        try { eventId = await deps.poster.thread(draft.roomId, draft.threadId, body); sent = true; } catch (e) { error = `post_failed: ${(e as Error).message}`; }
      }
      if (sent) {
        error = null;
        deps.state.recordPost(draft.roomId, key, eventId);
        posts.push({ route: 'public_thread', room_id: draft.roomId, room_name: draft.roomName, thread_id: draft.threadId, event_id: eventId, body });
      } else {
        const note = `Couldn't post this reply in ${draft.roomName} (thread ${draft.threadId}). Draft:\n${body}`;
        try {
          const id = await deps.poster.owner(note);
          if (deps.poster.ownerRoom) posts.push({ route: 'owner_private', room_id: deps.poster.ownerRoom.id, room_name: deps.poster.ownerRoom.name, thread_id: null, event_id: id, body: note });
        } catch (e) { error += `; owner note FAILED: ${(e as Error).message}`; }
      }
    }
  }
  return finish(plans, posts, events, usage, error, true);
}

function finish(plans: { it: ModelItem; verdict: string | null; sources: Verified[] }[], posts: TracePost[], events: string[], usage: Usage | null, error: string | null, keepSources: boolean): PublicResult {
  return { items: plans.map((p) => traceItem(p.it, p.verdict, keepSources ? p.sources : [])), posts, events, usage, error };
}
