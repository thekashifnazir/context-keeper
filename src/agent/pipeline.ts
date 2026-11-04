// pipeline: one decision = one or more messages from one person (a burst) → at most 2 model calls
// (cited verdict, then reviewer inside postPublic) → at most one public reply → one ck.trace/1 line.
// Never acts on its own posts (checked by sender id). Fails quiet: on a model error nothing goes
// public, the owner desk gets "couldn't check this one", and the caller retries once after 60 s.
import { randomUUID } from 'node:crypto';
import { writeTrace, type TraceItem, type TraceLine, type TracePost } from '../shared/trace.ts';
import type { RoomContext } from './blocks.ts';
import { callVerdict, errorKind, type Claude, type ModelConfig, type Usage } from './model.ts';
import { planJobs } from './owner-desk.ts';
import { PendingStore } from './pending.ts';
import { postPublic, type Poster } from './post.ts';
import type { AgentState } from './state.ts';
import { parseVerdict, ParseError } from './verdict.ts';

export interface Input {
  message_id: string;
  sender: string; // Switch sender id
  sender_name: string; // display name
  body: string;
  received_at: string; // ISO
  thread_id?: string | null;
}

export interface Deps {
  claude: Claude;
  cfg: ModelConfig;
  system: string;
  poster: Poster;
  state: AgentState;
  selfSenders: Set<string>;
  traceFile?: string;
  sleep?: (ms: number) => Promise<void>;
  /** Called once when the model key is rejected or credit is out: the agent should stop. */
  onFatal?: (why: string) => void;
  /** The room owner's Switch sender id: only they confirm decisions (B) and rule on clashes (D). */
  ownerSender?: string | null;
  ownerName?: string; // display name, default "Kash"
  /** Open owner items (B confirms, D clashes); in-memory when not given. */
  pending?: PendingStore;
}

export interface Outcome { trace: TraceLine | null; retry: boolean; fatal: boolean }

export const RETRY_AFTER_MS = 60_000;

// Planted-instruction net, unioned with the model's own embedded_instruction flag (chat is data).
const INJECTION = /\b(ignore (all |your |the )?(previous |prior )?(rules|instructions)|disregard (your|the) (rules|instructions)|you are now|system prompt|tell everyone|confirm to (everyone|the room)|new instructions?:)/i;
export const looksInjected = (text: string) => INJECTION.test(text);

/** Messages this decision should not act on: our own posts (by sender id) and ones already handled. */
export function actionable(deps: Pick<Deps, 'selfSenders' | 'state'>, roomId: string, inputs: Input[]): Input[] {
  return inputs.filter((m) => !deps.selfSenders.has(m.sender) && !deps.state.isProcessed(roomId, m.message_id) && m.body.trim());
}

function modelSummary(cfg: ModelConfig, usages: Usage[]): TraceLine['model'] {
  if (!usages.length) return null;
  return {
    id: [...new Set(usages.map((u) => u.model))].join('+'),
    calls: usages.length,
    input_tokens: usages.reduce((a, u) => a + u.input, 0),
    cache_read_tokens: usages.reduce((a, u) => a + u.cacheRead, 0),
    cache_write_tokens: usages.reduce((a, u) => a + u.cacheWrite, 0),
    output_tokens: usages.reduce((a, u) => a + u.output, 0),
    latency_ms: usages.reduce((a, u) => a + u.ms, 0),
  };
}

const quietItem = (id: string): TraceItem => ({ message_id: id, job: 'none', verdict: null, restriction: null, clashes_with: null, sources: [], decision_record: null, brief_for: null });

export interface DecideResult extends Outcome { usages: Usage[] }

/** One attempt at a decision. `notifyOwnerOnError` is false on the retry, so the owner gets one note. */
export async function decide(deps: Deps, roomId: string, roomName: string, ctx: RoomContext, rawInputs: Input[], opts: { notifyOwnerOnError?: boolean } = {}): Promise<DecideResult> {
  const inputs = actionable(deps, roomId, rawInputs);
  if (!inputs.length) return { trace: null, retry: false, fatal: false, usages: [] };
  const usages: Usage[] = [];
  const base = {
    schema: 'ck.trace/1' as const,
    decision_id: randomUUID(),
    room_id: roomId,
    room_name: roomName,
    trigger: 'message' as const,
    inputs: inputs.map((m) => ({ message_id: m.message_id, sender: m.sender_name, body: m.body, received_at: m.received_at })),
    burst: inputs.length > 1
      ? { size: inputs.length, gap_s: Number(process.env.CK_BURST_GAP_S ?? 20), first_at: inputs[0].received_at, last_at: inputs[inputs.length - 1].received_at }
      : null,
  };
  const write = (line: Omit<TraceLine, keyof typeof base | 'ts'>): TraceLine => {
    const full: TraceLine = { ...base, ts: new Date().toISOString(), ...line };
    writeTrace(full, deps.traceFile);
    return full;
  };

  if (process.env.CK_PAUSE === '1') {
    return { trace: write({ kind: 'silence', items: inputs.map((m) => quietItem(m.message_id)), posts: [], model: null, error: 'paused (CK_PAUSE=1)' }), retry: false, fatal: false, usages };
  }

  // Call 1: the cited verdict.
  let items;
  try {
    const { msg, usage } = await callVerdict(deps.claude, deps.cfg, deps.system, ctx, inputs.map((m) => ({ message_id: m.message_id, sender: m.sender_name, body: m.body, received_at: m.received_at, thread_id: m.thread_id })));
    usages.push(usage);
    items = parseVerdict(msg, ctx, inputs.map((m) => m.message_id));
  } catch (e) {
    const kind = e instanceof ParseError ? 'retryable' : errorKind(e);
    return failQuiet(deps, write, inputs, roomName, usages, `model_error(${kind}): ${(e as Error).message}`, kind, opts.notifyOwnerOnError ?? true);
  }

  // Chat is data: a planted instruction changes nothing; we only record that we saw one.
  const notes: string[] = [];
  for (const it of items) {
    const body = inputs.find((m) => m.message_id === it.message_id)?.body ?? '';
    if (it.embedded_instruction || looksInjected(body)) notes.push(`embedded_instruction: ${it.message_id}`);
  }

  // Jobs B and D: owner-desk notes first (so "flagged to the owner" is never posted for a note that
  // didn't go), pending items saved, each item's public line set.
  const jobs = await planJobs(deps, roomId, roomName, ctx, inputs, items);
  notes.push(...jobs.events);

  // Everything public goes through postPublic (gate → reviewer → idempotent send).
  const threadId = inputs[0].thread_id ?? inputs[0].message_id;
  const pub = await postPublic({ claude: deps.claude, cfg: deps.cfg, poster: deps.poster, state: deps.state, pending: (deps.pending ??= new PendingStore(null)) }, ctx, {
    roomId, roomName, threadId, items,
    messages: inputs.map((m) => ({ message_id: m.message_id, sender: m.sender, sender_name: m.sender_name, body: m.body, received_at: m.received_at })),
  });
  if (pub.usage) usages.push(pub.usage);
  if (pub.error?.startsWith('reviewer_failed')) {
    return failQuiet(deps, write, inputs, roomName, usages, pub.error, errorKind(pub.error), opts.notifyOwnerOnError ?? true, pub.items, jobs.posts);
  }

  for (const it of items) {
    if (it.job === 'A' && it.verdict === 'new') {
      const m = inputs.find((x) => x.message_id === it.message_id)!;
      deps.state.addIdea(roomId, { message_id: m.message_id, by: m.sender_name, text: m.body, at: m.received_at });
    }
  }
  deps.state.markProcessed(roomId, inputs.map((m) => m.message_id));
  const events = [...notes, ...pub.events];
  const error = [pub.error, ...events].filter(Boolean).join('; ') || null;
  const posts = [...jobs.posts, ...pub.posts];
  const kind = posts.some((p) => p.route !== 'owner_private') ? 'reply' : posts.length ? 'owner_note' : 'silence';
  const trace = write({ kind, items: pub.items, posts, model: modelSummary(deps.cfg, usages), error });
  return { trace, retry: false, fatal: false, usages };
}

async function failQuiet(
  deps: Deps, write: (l: any) => TraceLine, inputs: Input[], roomName: string, usages: Usage[],
  error: string, kind: string, notify: boolean, items?: TraceItem[], earlier: TracePost[] = [],
): Promise<DecideResult> {
  const posts: TracePost[] = [...earlier];
  const fatal = kind === 'fatal';
  const note = fatal
    ? `Context Keeper stopped: the model key was rejected or credit ran out (${error}). Nothing was posted.`
    : `Couldn't check this one: message ${inputs[0].message_id} from ${inputs[0].sender_name} in ${roomName}. I'll retry once in a minute.`;
  if (notify || fatal) {
    try {
      const id = await deps.poster.owner(note);
      if (deps.poster.ownerRoom) posts.push({ route: 'owner_private', room_id: deps.poster.ownerRoom.id, room_name: deps.poster.ownerRoom.name, thread_id: null, event_id: id, body: note });
    } catch (e) { error += `; owner note FAILED: ${(e as Error).message}`; }
  }
  if (fatal) deps.onFatal?.(error);
  const trace = write({
    kind: posts.length ? 'owner_note' : 'silence',
    items: items?.map((i) => ({ ...i, sources: [] })) ?? inputs.map((m) => quietItem(m.message_id)),
    posts, model: modelSummary(deps.cfg, usages), error,
  });
  return { trace, retry: kind === 'retryable', fatal, usages };
}

/** A decision with the fail-quiet retry: on a retryable error, wait 60 s and try once more. */
export async function decideWithRetry(deps: Deps, roomId: string, roomName: string, ctx: RoomContext, inputs: Input[]): Promise<DecideResult[]> {
  const first = await decide(deps, roomId, roomName, ctx, inputs);
  if (!first.retry) return [first];
  await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(RETRY_AFTER_MS);
  const second = await decide(deps, roomId, roomName, ctx, inputs, { notifyOwnerOnError: false });
  return [first, second];
}
