// owner-desk: the private route to the room owner, for job B (confirm a decision) and job D (rule
// on a clash). planJobs() runs inside a decision, before postPublic: it sends the desk notes, saves
// each open item in the pending store (state/, survives restarts), and sets the public line each
// item may post. handleOwnerDesk() reads the owner's text reply in the desk (reactions never reach
// agents) and posts the result back in the original thread. Only the owner's sender id counts: a
// "confirm" from anyone else is logged and ignored. Owner-desk text is never quoted in public: the
// public line is built from structured fields.
import { randomUUID } from 'node:crypto';
import { writeTrace, type TraceItem, type TraceLine, type TracePost } from '../shared/trace.ts';
import type { RoomContext } from './blocks.ts';
import { confirmNote, loggedLine, readPlain } from './jobs/decision.ts';
import { clashNote, neutralClashLine, personalReply } from './jobs/restriction.ts';
import { callOwnerReply, type OwnerReading, type Usage } from './model.ts';
import { PendingStore, type PendingItem } from './pending.ts';
import type { Deps, Input } from './pipeline.ts';
import { sendOwner, sendPublic } from './post.ts';
import type { ModelItem } from './verdict.ts';

export const ownerNameOf = (deps: Pick<Deps, 'ownerName'>) => deps.ownerName || 'Kash';
export const isOwner = (deps: Pick<Deps, 'ownerSender'>, sender: string) => !!deps.ownerSender && sender === deps.ownerSender;
const store = (deps: Deps): PendingStore => (deps.pending ??= new PendingStore(null));

/** The decision row a clash id names ("D2"), as code knows it from the record, never from the model. */
function decisionRow(ctx: RoomContext, it: ModelItem): string | null {
  if (!it.clashes_with) return null;
  const id = it.clashes_with.trim().toUpperCase();
  const cited = it.cited.find((c) => c.block.kind === 'row' && c.block.blockId.endsWith(` ${id}`));
  const row = cited?.block ?? ctx.table.flat().find((b) => b.kind === 'row' && b.blockId.endsWith(` ${id}`));
  return row ? row.display : null;
}

/** Jobs B and D, before anything public: desk notes out, pending items saved, public lines set. */
export async function planJobs(deps: Deps, roomId: string, roomName: string, ctx: RoomContext, inputs: Input[], items: ModelItem[]): Promise<{ posts: TracePost[]; events: string[] }> {
  const posts: TracePost[] = [];
  const events: string[] = [];
  const owner = ownerNameOf(deps);
  for (const it of items) {
    const m = inputs.find((x) => x.message_id === it.message_id);
    if (!m || (it.job !== 'B' && it.job !== 'D')) continue;
    const threadId = m.thread_id ?? m.message_id;
    const base = { room_id: roomId, room_name: roomName, thread_id: threadId, message_id: m.message_id, raised_by: m.sender_name, raised_by_sender: m.sender, text: m.body, details: it.details, created_at: m.received_at };

    if (it.job === 'B') {
      const summary = it.details.summary || m.body.trim();
      if (isOwner(deps, m.sender)) {
        // The owner said it himself: his message is the confirmation. One short line, no desk note.
        it.decision_record = { summary, owner, date: it.details.date };
        it.reply = loggedLine({ summary, owner: '', date: it.details.date, confirmedBy: owner });
        const p = store(deps).add({ ...base, kind: 'B', status: 'open', clashes_with: null });
        if (p.status === 'open') store(deps).resolve(p.n, 'confirmed', { by: m.sender, message_id: m.message_id, summary, owner: '', date: it.details.date, line: it.reply });
        events.push(`decision #${p.n} stated by the owner: confirmed`);
      } else {
        it.decision_record = { summary, owner: it.details.suggested_owner || owner, date: it.details.date };
        it.reply = ''; // nothing public until the decision makers confirm
        const p = store(deps).add({ ...base, kind: 'B', status: 'open', clashes_with: null });
        if (p.note_event_id) { events.push(`decision #${p.n}: desk note already sent`); continue; }
        const sent = await sendOwner(deps, confirmNote({ n: p.n, roomName, raisedBy: m.sender_name, text: m.body, details: it.details, messageRef: m.message_id }), events);
        if (sent.post) posts.push(sent.post);
        if (sent.eventId) store(deps).setNoteEvent(p.n, sent.eventId);
        if (sent.error) events.push(`decision #${p.n}: ${sent.error}`);
        else events.push(`decision #${p.n} pending the owner's confirm`);
      }
      continue;
    }

    // Job D
    if (it.restriction === 'personal') {
      it.reply = personalReply(it.reply, m.sender_name);
      continue;
    }
    if (it.restriction === 'project') {
      const p = store(deps).add({ ...base, kind: 'D', status: 'open', clashes_with: it.clashes_with });
      if (p.note_event_id) { it.reply = neutralClashLine(m.sender_name); events.push(`clash #${p.n}: desk note already sent`); continue; }
      const note = clashNote({ n: p.n, roomName, raisedBy: m.sender_name, text: m.body, clashesWith: it.clashes_with, details: it.details, decisionText: decisionRow(ctx, it), messageRef: m.message_id });
      const sent = await sendOwner(deps, note, events);
      if (sent.post) posts.push(sent.post);
      if (sent.eventId) store(deps).setNoteEvent(p.n, sent.eventId);
      if (sent.post || sent.eventId) {
        it.reply = neutralClashLine(m.sender_name);
        events.push(`clash #${p.n} sent to the owner desk`);
      } else {
        // Never say "flagged to the owner" when the note didn't go.
        it.reply = '';
        events.push(`clash #${p.n}: ${sent.error ?? 'owner note not sent'}; no public line`);
      }
    }
  }
  return { posts, events };
}

// ---- the owner's reply in the desk -----------------------------------------------------------------

function findItem(deps: Deps, input: Input): { item: PendingItem | null; ambiguous: PendingItem[] } {
  const open = store(deps).open();
  if (input.thread_id) {
    const byThread = open.find((i) => i.note_event_id && i.note_event_id === input.thread_id);
    if (byThread) return { item: byThread, ambiguous: [] };
  }
  const ref = input.body.match(/#(\d+)\b/);
  if (ref) {
    const byRef = open.find((i) => i.n === Number(ref[1]));
    return { item: byRef ?? null, ambiguous: [] };
  }
  if (open.length === 1) return { item: open[0], ambiguous: [] };
  return { item: null, ambiguous: open };
}

const quiet = (id: string, job: TraceItem['job'] = 'none'): TraceItem => ({ message_id: id, job, verdict: null, restriction: null, clashes_with: null, sources: [], decision_record: null, brief_for: null });

/** One owner-desk message. Returns the trace line, or null when it isn't ours to act on. */
export async function handleOwnerDesk(deps: Deps, deskRoomId: string, deskRoomName: string, input: Input): Promise<TraceLine | null> {
  if (deps.selfSenders.has(input.sender) || deps.state.isProcessed(deskRoomId, input.message_id) || !input.body.trim()) return null;
  const usages: Usage[] = [];
  const posts: TracePost[] = [];
  const events: string[] = [];
  const write = (kind: TraceLine['kind'], items: TraceItem[], error: string | null): TraceLine => {
    const line: TraceLine = {
      schema: 'ck.trace/1', ts: new Date().toISOString(), decision_id: randomUUID(), room_id: deskRoomId, room_name: deskRoomName,
      kind, trigger: 'message', inputs: [{ message_id: input.message_id, sender: input.sender_name, body: input.body, received_at: input.received_at }],
      burst: null, items, posts,
      model: usages.length ? { id: [...new Set(usages.map((u) => u.model))].join('+'), calls: usages.length, input_tokens: usages.reduce((a, u) => a + u.input, 0), cache_read_tokens: usages.reduce((a, u) => a + u.cacheRead, 0), cache_write_tokens: usages.reduce((a, u) => a + u.cacheWrite, 0), output_tokens: usages.reduce((a, u) => a + u.output, 0), latency_ms: usages.reduce((a, u) => a + u.ms, 0) } : null,
      error: [error, ...events].filter(Boolean).join('; ') || null,
    };
    writeTrace(line, deps.traceFile);
    deps.state.markProcessed(deskRoomId, [input.message_id]);
    return line;
  };

  if (!isOwner(deps, input.sender)) return write('silence', [quiet(input.message_id)], `owner_desk: ignored, ${input.sender} is not the owner`);

  const { item, ambiguous } = findItem(deps, input);
  if (!item) {
    if (ambiguous.length) {
      const ask = `Which one? Open: ${ambiguous.map((i) => `#${i.n} ${i.kind === 'B' ? 'decision' : 'clash'} from ${i.raised_by} ("${i.details.summary || i.text}")`).join('; ')}. Start your reply with the number.`;
      const s = await sendOwner(deps, ask, events);
      if (s.post) posts.push(s.post);
      return write(posts.length ? 'owner_note' : 'silence', [quiet(input.message_id)], 'owner_desk: reply matched more than one open item');
    }
    return write('silence', [quiet(input.message_id)], 'owner_desk: no open item for this reply');
  }

  // What did the owner decide? Plain replies are read by code; anything else by one model call.
  let reading: OwnerReading;
  const plain = readPlain(input.body, item.kind);
  if (plain) {
    reading = { action: plain.action, summary: '', owner: plain.owner, date: plain.date, line: item.kind === 'D' ? 'the plan stands.' : '' };
  } else {
    try {
      const r = await callOwnerReply(deps.claude, deps.cfg, { kind: item.kind, summary: item.details.summary || item.text, suggested_owner: item.details.suggested_owner, date: item.details.date, options: item.details.options }, input.body);
      usages.push(r.usage);
      reading = r.reading;
    } catch (e) {
      const s = await sendOwner(deps, `Couldn't read that reply for #${item.n}. Nothing was posted. Try "confirm", "owner <name>", or "drop".`, events);
      if (s.post) posts.push(s.post);
      return write(posts.length ? 'owner_note' : 'silence', [quiet(input.message_id, item.kind)], `owner_reply_model_error: ${(e as Error).message}`);
    }
  }

  const owner = ownerNameOf(deps);
  const ti: TraceItem = { ...quiet(input.message_id, item.kind), verdict: item.kind === 'B' ? 'decision' : null, restriction: item.kind === 'D' ? 'project' : null, clashes_with: item.clashes_with };
  if (reading.action === 'unclear' || (item.kind === 'D' && reading.action === 'confirm' && !reading.line.trim())) {
    const s = await sendOwner(deps, `I couldn't tell what you decided on #${item.n}, so nothing was posted. ${item.kind === 'B' ? 'Try "confirm", "owner <name>", a corrected line, or "drop".' : 'Reply with your ruling in a sentence, or "plan stands".'}`, events);
    if (s.post) posts.push(s.post);
    return write(posts.length ? 'owner_note' : 'silence', [ti], `owner_desk: #${item.n} reply unclear`);
  }
  if (reading.action === 'drop') {
    store(deps).resolve(item.n, 'dropped', { by: input.sender, message_id: input.message_id, summary: '', owner: '', date: '', line: '' });
    return write('silence', [ti], `owner_desk: #${item.n} dropped by the owner; nothing posted`);
  }

  let line: string;
  let resolution: NonNullable<PendingItem['resolution']>;
  if (item.kind === 'B') {
    const summary = reading.summary || item.details.summary || item.text;
    const actionOwner = reading.owner || item.details.suggested_owner;
    const date = reading.date || item.details.date;
    line = loggedLine({ summary, owner: actionOwner, date, confirmedBy: owner });
    ti.decision_record = { summary, owner: actionOwner || owner, date };
    resolution = { by: input.sender, message_id: input.message_id, summary, owner: actionOwner, date, line };
  } else {
    const ruling = reading.line.trim();
    line = `Update from ${owner}: ${ruling.charAt(0).toUpperCase()}${ruling.slice(1)}`;
    resolution = { by: input.sender, message_id: input.message_id, summary: '', owner: '', date: '', line };
  }
  const sent = await sendPublic(deps, item.room_id, item.room_name, item.thread_id, line, events);
  posts.push(...sent.posts);
  if (sent.posts.some((p) => p.route === 'public_thread')) store(deps).resolve(item.n, 'confirmed', resolution);
  return write(sent.posts.some((p) => p.route !== 'owner_private') ? 'reply' : posts.length ? 'owner_note' : 'silence', [ti], sent.error);
}
