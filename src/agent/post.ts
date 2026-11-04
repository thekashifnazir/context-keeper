// post: the only way anything reaches a public thread. postPublic() runs, in order:
//   1. the quote gate: every cited block's text (header stripped) must be verbatim in its source
//      (src/shared/quote.ts, the scorer's own rule). A strong verdict with no verified quote drops to
//      might-be-related with the link; with no citation at all it becomes silence + gate_blocked.
//   2. the reviewer (one Haiku call for the decision; sees only each claim and its quotes). A block
//      drops covered / parked / contradicts-record / reopen / parked-recall to might-be-related.
//   3. compose: the model's reply, then the quote and who/when, built by code from verified text.
//   4. idempotency (room + thread + text hash, in state/), then send; a failed send retries once,
//      then the owner desk gets the exact draft.
// A reopen (D4-2) that passes the reviewer goes to the owner desk first (src/agent/jobs/reopen.ts);
// the room then gets code's "asked the owner, plan stands" line above the decision's quote.
// Jobs B and D post their lines through here too (no quotes in them; a project clash's line is
// checked for leaked details), and job C's brief goes through postBrief: the same gate and reviewer.
// Code rules here only ever tighten a verdict, never loosen it.
import { quoteVerified } from '../shared/quote.ts';
import type { TraceItem, TracePost } from '../shared/trace.ts';
import { reviewText, type BlockInfo, type RoomContext } from './blocks.ts';
import { decisionId, reopenIf, reopenLine, reopenNote } from './jobs/reopen.ts';
import { leaksClash } from './jobs/restriction.ts';
import { PendingStore } from './pending.ts';
import { callReviewer, type BriefLine, type Claude, type ModelConfig, type Usage } from './model.ts';
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

export interface Verified { ref: string; quote: string; display: string; who: string; full: string; block: BlockInfo }

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
    verified.push({ ref: b.ref, quote, display: b.display, who, full: c.citedText, block: b });
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
  /** The messages the items answer: a reopen's reviewer reads the new message, and its desk note quotes it. */
  messages?: { message_id: string; sender: string; sender_name: string; body: string; received_at: string }[];
}

const MIGHT_BE = `This might be related, though I can't confirm it answers your question:`;

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
  decision_record: it.decision_record ?? null,
  brief_for: null,
  new_part: buildsOnPart(it, verdict, sources),
});

/** Job A's new part counts only on its own might-be-related verdict (never a gate or reviewer
 *  downgrade: parseVerdict keeps new_part for that verdict alone) that kept a verified source. */
const buildsOnPart = (it: ModelItem, verdict: string | null, sources: Verified[]) =>
  (it.job === 'A' && it.verdict === 'might-be-related' && verdict === 'might-be-related' && sources.length ? it.new_part : null);

/** Job A's reply, plus code's line that the new part is logged, when it builds on the record (Kash, 4 Nov). */
const replyFor = (it: ModelItem) =>
  (it.job === 'A' && it.verdict === 'might-be-related' && it.new_part && announceNew() ? `${it.reply.trim()} I've logged that part as a new idea: ${it.new_part}.` : it.reply);

export async function postPublic(
  deps: { claude: Claude; cfg: ModelConfig; poster: Poster; state: AgentState; pending?: PendingStore },
  ctx: RoomContext,
  draft: PublicDraft,
): Promise<PublicResult> {
  const msgOf = (id: string) => draft.messages?.find((m) => m.message_id === id) ?? null;
  const events: string[] = [];
  type Plan = { it: ModelItem; verdict: string | null; sources: Verified[]; body: string | null };
  const plans: Plan[] = [];

  // 1. quote gate
  for (const it of draft.items) {
    const { verified, refsSeen } = gateSources(it.cited, ctx);
    let verdict = it.verdict;
    let body: string | null = null;
    if (it.job === 'A' && verdict && (STRONG.has(verdict) || verdict === 'might-be-related')) {
      if (verdict === 'reopen' && verified.length && (!verified.some((v) => v.block.kind === 'row') || !msgOf(it.message_id))) {
        // A reopen must quote the decision row it reopens (code checks; the model's word isn't enough).
        events.push(`gate: ${it.message_id} reopen→might-be-related (no decision row quoted)`);
        verdict = 'might-be-related';
        body = compose(MIGHT_BE, verified);
      } else if (verified.length) {
        body = compose(replyFor(it), verified);
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
    } else if ((it.job === 'B' || it.job === 'D') && it.reply.trim()) {
      body = it.reply.trim();
      const quotes = [...verified.map((v) => v.quote), ...it.cited.map((c) => c.block.body)];
      if (it.job === 'D' && it.restriction === 'project' && leaksClash(body, it.clashes_with, quotes)) {
        events.push(`clash_leak_blocked: ${it.message_id} public line carried clash details; neutral line used`);
        body = "Noted, and I've flagged it to the owner. The plan stays as it is until they decide.";
      }
    }
    plans.push({ it, verdict, sources: verified, body });
  }

  // 2. reviewer: strong verdicts with verified quotes only
  let usage: Usage | null = null;
  const toReview = plans.filter((p) => p.body && p.verdict && STRONG.has(p.verdict) && p.sources.length);
  if (toReview.length) {
    try {
      // A reopen claim rests on two things: the quoted decision (with its "Reopen if") and what the
      // person just said. Only a reopen check carries new_message; every other check is quotes only.
      const r = await callReviewer(deps.claude, deps.cfg, toReview.map((p) => {
        const m = p.verdict === 'reopen' ? msgOf(p.it.message_id) : null;
        return { id: p.it.message_id, claim: p.it.claim || p.it.reply, quotes: p.sources.map((s) => reviewText(s.block, s.full)), ...(m ? { new_message: { from: m.sender_name, at: m.received_at, text: m.body } } : {}) };
      }));
      usage = r.usage;
      for (const p of toReview) {
        const rv = r.reviews.get(p.it.message_id);
        if (rv?.supports) continue;
        events.push(`reviewer: ${p.it.message_id} ${p.verdict}→might-be-related (${rv?.issue || 'no result'})`);
        p.verdict = 'might-be-related';
        p.body = compose(MIGHT_BE, p.sources);
      }
    } catch (e) {
      // Fail quiet: nothing reaches the room without a passed review.
      events.push(`reviewer_failed: ${(e as Error).message}`);
      for (const p of plans) { p.body = null; if (p.verdict && (STRONG.has(p.verdict) || p.verdict === 'might-be-related')) p.verdict = null; }
      return finish(plans, [], events, usage, `reviewer_failed: ${(e as Error).message}`, false);
    }
  }

  // 2b. reopen: the owner desk first, so the room is never told "asked the owner" for a note that didn't go.
  const deskPosts: TracePost[] = [];
  for (const p of plans.filter((x) => x.verdict === 'reopen' && x.body)) {
    const m = msgOf(p.it.message_id)!;
    const rowSrc = p.sources.find((s) => s.block.kind === 'row')!;
    const routed = await routeReopen(deps, draft, m, rowSrc.block, p.it.claim, events);
    if (routed) {
      deskPosts.push(...routed);
      p.sources = [rowSrc, ...p.sources.filter((s) => s !== rowSrc)];
      p.body = compose(reopenLine(m.sender_name, reopenIf(rowSrc.block)), p.sources);
    } else {
      events.push(`reopen: ${p.it.message_id} reopen→might-be-related (owner note not sent)`);
      p.verdict = 'might-be-related';
      p.body = compose(MIGHT_BE, p.sources);
    }
  }

  // 3. compose one post per decision (a burst gets one combined reply), 4. idempotent send
  const bodies = plans.filter((p) => p.body).map((p) => p.body!);
  let posts: TracePost[] = [];
  let error: string | null = null;
  if (bodies.length) ({ posts, error } = await sendPublic(deps, draft.roomId, draft.roomName, draft.threadId, bodies.join('\n\n'), events));
  return finish(plans, [...deskPosts, ...posts], events, usage, error, true);
}

/** Sends a reopen request's desk note once (a retry finds the pending item and its note) and saves
 *  it as an open owner item (job D's route: the owner's ruling comes back in the thread). Returns the
 *  desk posts (empty when the note was already sent earlier), or null when the note couldn't go. */
async function routeReopen(
  deps: { poster: Poster; state: AgentState; pending?: PendingStore }, draft: PublicDraft,
  m: NonNullable<PublicDraft['messages']>[number], row: BlockInfo, claim: string, events: string[],
): Promise<TracePost[] | null> {
  const pending = (deps.pending ??= new PendingStore(null));
  const id = decisionId(row);
  const cond = reopenIf(row);
  const p = pending.add({
    kind: 'D', route: 'reopen', status: 'open', room_id: draft.roomId, room_name: draft.roomName, thread_id: draft.threadId ?? m.message_id,
    message_id: m.message_id, raised_by: m.sender_name, raised_by_sender: m.sender, text: m.body, clashes_with: id, created_at: m.received_at,
    details: { summary: `Reopen ${id}? ${claim}`.trim(), why: row.display, date: '', action_owner: '', suggested_owner: '', owner_basis: '', reopen_if: cond, options: [`Keep ${id} as decided`, `Reopen ${id}`] },
  });
  if (p.note_event_id) { events.push(`reopen #${p.n}: desk note already sent`); return []; }
  const sent = await sendOwner(deps, reopenNote({ n: p.n, roomName: draft.roomName, raisedBy: m.sender_name, text: m.body, messageRef: m.message_id, row, claim }), events);
  if (sent.eventId) pending.setNoteEvent(p.n, sent.eventId);
  if (!sent.post && !sent.eventId) { events.push(`reopen #${p.n}: ${sent.error ?? 'owner note not sent'}`); return null; }
  events.push(`reopen #${p.n} (${id}) sent to the owner desk`);
  return sent.post ? [sent.post] : [];
}

function finish(plans: { it: ModelItem; verdict: string | null; sources: Verified[] }[], posts: TracePost[], events: string[], usage: Usage | null, error: string | null, keepSources: boolean): PublicResult {
  return { items: plans.map((p) => traceItem(p.it, p.verdict, keepSources ? p.sources : [])), posts, events, usage, error };
}

/** Idempotent send into a public thread: a failed send retries once, then the owner desk gets the draft. */
export async function sendPublic(
  deps: { poster: Poster; state: AgentState }, roomId: string, roomName: string, threadId: string | null, body: string, events: string[],
): Promise<{ posts: TracePost[]; error: string | null }> {
  const posts: TracePost[] = [];
  let error: string | null = null;
  const key = postKey(roomId, threadId, body);
  if (deps.state.postedEvent(key, roomId) !== undefined) { events.push(`duplicate suppressed: ${key}`); return { posts, error }; }
  let eventId: string | null = null;
  let sent = false;
  for (let attempt = 0; attempt < 2 && !sent; attempt++) {
    try { eventId = await deps.poster.thread(roomId, threadId, body); sent = true; } catch (e) { error = `post_failed: ${(e as Error).message}`; }
  }
  if (sent) {
    deps.state.recordPost(roomId, key, eventId);
    posts.push({ route: 'public_thread', room_id: roomId, room_name: roomName, thread_id: threadId, event_id: eventId, body });
    return { posts, error: null };
  }
  const note = `Couldn't post this reply in ${roomName} (thread ${threadId}). Draft:\n${body}`;
  try {
    const id = await deps.poster.owner(note);
    if (deps.poster.ownerRoom) posts.push({ route: 'owner_private', room_id: deps.poster.ownerRoom.id, room_name: deps.poster.ownerRoom.name, thread_id: null, event_id: id, body: note });
  } catch (e) { error += `; owner note FAILED: ${(e as Error).message}`; }
  return { posts, error };
}

/** Idempotent owner-desk note (a retried decision never sends the same note twice). */
export async function sendOwner(deps: { poster: Poster; state: AgentState }, body: string, events: string[]): Promise<{ post: TracePost | null; eventId: string | null; error: string | null }> {
  const room = deps.poster.ownerRoom;
  if (!room) return { post: null, eventId: null, error: 'no owner desk' };
  const key = postKey(room.id, null, body);
  const prior = deps.state.postedEvent(key, room.id);
  if (prior !== undefined) { events.push(`duplicate owner note suppressed: ${key}`); return { post: null, eventId: prior, error: null }; }
  try {
    const id = await deps.poster.owner(body);
    deps.state.recordPost(room.id, key, id);
    return { post: { route: 'owner_private', room_id: room.id, room_name: room.name, thread_id: null, event_id: id, body }, eventId: id, error: null };
  } catch (e) {
    return { post: null, eventId: null, error: `owner_note_failed: ${(e as Error).message}` };
  }
}

// ---- job C: the brief --------------------------------------------------------------------------

export interface BriefResult { posts: TracePost[]; sources: { ref: string; quote: string }[]; events: string[]; usage: Usage | null; error: string | null; kept: number }

/** Gate (each line's quote verbatim in its block's source) → reviewer (does the quote back the line?)
 *  → compose → idempotent send. Lines that fail either check are dropped; with none left, nothing posts. */
export async function postBrief(
  deps: { claude: Claude; cfg: ModelConfig; poster: Poster; state: AgentState },
  ctx: RoomContext,
  draft: { roomId: string; roomName: string; threadId: string | null; opening: string; closing: string; lines: BriefLine[] },
): Promise<BriefResult> {
  const events: string[] = [];
  const blocks = new Map(ctx.table.flat().map((b) => [b.blockId, b]));
  type Kept = { line: BriefLine; ref: string; quote: string; full: string };
  const kept: Kept[] = [];
  draft.lines.forEach((l, i) => {
    const b = blocks.get(l.block) ?? ctx.table.flat().find((x) => x.ref === l.block && quoteVerified(l.quote, x.body));
    const src = b ? ctx.sourceText.get(b.ref) : undefined;
    if (!b || !src || !quoteVerified(l.quote, b.body) || !quoteVerified(l.quote, src)) { events.push(`brief_gate: line ${i + 1} dropped (quote not in ${l.block || 'any block'})`); return; }
    kept.push({ line: l, ref: b.ref, quote: l.quote, full: reviewText(b) });
  });
  let usage: Usage | null = null;
  if (kept.length) {
    try {
      const r = await callReviewer(deps.claude, deps.cfg, kept.map((k, i) => ({ id: `line${i + 1}`, claim: k.line.text, quotes: [k.full] })));
      usage = r.usage;
      const before = kept.length;
      for (let i = before - 1; i >= 0; i--) {
        const rv = r.reviews.get(`line${i + 1}`);
        if (!rv?.supports) { events.push(`brief_reviewer: line ${i + 1} dropped (${rv?.issue || 'no result'})`); kept.splice(i, 1); }
      }
    } catch (e) {
      events.push(`reviewer_failed: ${(e as Error).message}`);
      return { posts: [], sources: [], events, usage, error: `reviewer_failed: ${(e as Error).message}`, kept: 0 };
    }
  }
  if (!kept.length) {
    events.push('brief_gate_blocked: no line survived the gate and the reviewer');
    return { posts: [], sources: [], events, usage, error: null, kept: 0 };
  }
  const body = [draft.opening, ...kept.slice(0, 5).map((k) => `• ${k.line.text} (${k.ref})`), draft.closing].filter(Boolean).join('\n');
  const { posts, error } = await sendPublic(deps, draft.roomId, draft.roomName, draft.threadId, body, events);
  return { posts, sources: kept.slice(0, 5).map((k) => ({ ref: k.ref, quote: k.quote })), events, usage, error, kept: Math.min(kept.length, 5) };
}
