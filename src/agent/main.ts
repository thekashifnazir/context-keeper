// main: the live Context Keeper (jobs A, B, C text, D). Listens to every room it's in (untagged), batches each
// person's messages until they go quiet (CK_BURST_GAP_S, 90 s hard cap), runs the pipeline, and
// saves its stream position so a restart resumes instead of dropping what came in meanwhile. The
// unsent burst queue and the room's live messages are saved as well (CK_STATE_DIR/agent-buffer.json,
// live/<room>.jsonl), so a restart neither loses a queued message nor forgets what was said earlier.
//   npx tsx src/agent/main.ts
// Safety while other lanes are live: it only posts into rooms whose name starts with one of
// CK_POST_ROOMS (default "ck-smoke-,ck-eval-"); everywhere else it decides, traces and logs the
// draft, but sends nothing. The owner desk gets posts only with CK_POST_OWNER=1.
// CK_LISTEN_ROOMS (prefixes, unset = every room) limits which rooms it connects to at all: the eval
// sets it to its own run's ck-eval-<runid>- rooms, since connect_to_room takes a room from any other
// session of the agent. CK_STATE_DIR (default state) holds its local files; CK_OWNER_DESK_ROOM
// overrides state/owner.json's desk (the eval passes the desk the seed made).
// Room record: read from Switch (src/agent/memory.ts): the room's documents (list_references +
// load_internal_documents, the "Channel archive" among them), the room's history (read_context), then
// every live message as it arrives. Its own "Decision log" room document is written by job B.
// Nothing is read from demo/ (that is only the seed's source and the offline tests').
// Owner desk (state/owner.json, or CK_OWNER_SENDER / CK_OWNER_DESK_ROOM): its messages never go to
// job A; the owner's text reply there confirms a decision (B) or rules on a clash (D). A room_join
// (Switch sends it just before the person's first message) marks them for a catch-up brief (C).
// Stream: a heartbeat_lapsed or closed eviction is logged and the runtime reconnects from its position;
// only a takeover or rejected credentials stop it (exit 3). CK_STREAM_WATCHDOG_SEC (default 120, 0 = off):
// no event, ping or heartbeat for that long → a fresh stream from the saved position; three dead
// restarts in a row → exit 4, for the supervisor to restart (src/agent/stream-watchdog.ts).
// Optional parts, each on by default here and off in the eval runner (src/agent/features.ts):
//   CK_JOB_E        job E: idea → "approve I<n>" in the owner desk → Claude Code in CK_BUILD_ROOM → the
//                   raiser signs it off in the original thread (src/agent/handoff/, docs/handoff-live-test.md)
//   CK_AUDIO_BRIEF  job C's audio clip under the text brief; CK_TALK_LINK its "talk it through" link and
//                   the call summary afterwards (src/voice/live.ts; need ELEVENLABS_API_KEY)
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { SwitchEventStream, type AgentBridgeEvent, type MessagePayload } from '../../vendor/switch-agent-runtime/src/index.ts';
import { EVICTION_CREDENTIALS_REJECTED, EVICTION_TAKEN_OVER } from '../../vendor/switch-agent-runtime/src/event-stream.ts';
import type { RoomJoinPayload } from '../../vendor/switch-agent-runtime/src/types.ts';
import { displayName } from '../names.ts';
import { buildRoomContext } from './blocks.ts';
import { briefTrigger, runBrief, type BriefOpts } from './jobs/brief.ts';
import { featuresFromEnv } from './features.ts';
import { HandleMemo, isAgentSender, noteNewIdeas, toHandoffMsg } from './handoff/dispatch.ts';
import { handoffFromEnv } from './handoff/wire.ts';
import { handleOwnerDesk } from './owner-desk.ts';
import { PendingStore } from './pending.ts';
import { loadEnv } from './env.ts';
import { modelConfigFromEnv, realClaude } from './model.ts';
import { decideWithRetry, type Deps, type Input } from './pipeline.ts';
import type { Poster } from './post.ts';
import { systemPrompt } from './prompt.ts';
import { isDocNotice, RoomMemory } from './memory.ts';
import type { RoomRecord } from './room.ts';
import { AgentState, atomicWriteJson } from './state.ts';
import { DEFAULT_MAX_RESTARTS, StreamWatchdog, watchdogMsFromEnv, type StreamHandle } from './stream-watchdog.ts';
import { realEleven } from '../voice/eleven.ts';
import { VoiceLive } from '../voice/live.ts';
import { readTalkIdeas } from '../voice/talk-ideas.ts';
import { DEFAULT_PORT as TOOL_PORT, startToolServer, toolSecret, tunnelUrl } from '../voice/talk-tool.ts';
import { realSwitchMedia } from '../voice/post-audio.ts';

loadEnv();
const need = (k: string) => process.env[k] || (console.error(`missing ${k}`), process.exit(1));
const endpoint = need('SWITCH_API_URL');
const agentId = need('SWITCH_AGENT_ID');
const token = need('SWITCH_AGENT_API_KEY');
const SD = process.env.CK_STATE_DIR || 'state';
mkdirSync(SD, { recursive: true });

const readJson = <T,>(f: string, d: T): T => { try { return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : d; } catch { return d; } };
const idFile = `${SD}/agent-connection.json`;
const connectionId = readJson<{ id?: string }>(idFile, {}).id ?? randomUUID();
atomicWriteJson(idFile, { id: connectionId });
const posFile = `${SD}/agent-position.json`;
const roomsFile = `${SD}/agent-rooms.json`;
const ownerFile = readJson<{ owner_desk_room?: string; owner_sender?: string; owner_handle?: string }>(`${SD}/owner.json`, {});
const owner = { owner_desk_room: process.env.CK_OWNER_DESK_ROOM || ownerFile.owner_desk_room, owner_sender: process.env.CK_OWNER_SENDER || ownerFile.owner_sender };
const prefixes = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);
const postPrefixes = prefixes(process.env.CK_POST_ROOMS ?? 'ck-smoke-,ck-eval-');
const listenPrefixes = process.env.CK_LISTEN_ROOMS ? prefixes(process.env.CK_LISTEN_ROOMS) : null;
const gapMs = Number(process.env.CK_BURST_GAP_S ?? 20) * 1000;
const CAP_MS = 90_000;

const sessions = new Map<string, string>();
async function op(roomId: string | null, name: string, args: Record<string, unknown>): Promise<any> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Switch-Connection-Id': connectionId };
  if (roomId) {
    if (!sessions.has(roomId)) sessions.set(roomId, randomUUID());
    headers['X-Switch-Session-Id'] = sessions.get(roomId)!;
  }
  const res = await fetch(`${endpoint}/agents/${agentId}/ops/${name}`, { method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const roomNames = new Map<string, string>();
const allowed = (roomId: string) => postPrefixes.some((p) => (roomNames.get(roomId) ?? '').startsWith(p));
const ourEvents = new Set<string>();
const eventIdOf = (r: any): string | null => r?.result?.message_id ?? r?.result?.event_id ?? r?.message_id ?? r?.event_id ?? null;

const poster: Poster = {
  get ownerRoom() { return owner.owner_desk_room ? { id: owner.owner_desk_room, name: roomNames.get(owner.owner_desk_room) ?? 'owner desk' } : null; },
  async thread(roomId, threadId, body) {
    if (!allowed(roomId)) { console.log(`[dry-run: ${roomNames.get(roomId)} not in CK_POST_ROOMS] would reply:\n${body}`); return null; }
    await op(roomId, 'connect_to_room', { room_id: roomId });
    const id = eventIdOf(await op(roomId, 'post_message', { body, ...(threadId ? { thread_id: threadId } : {}) }));
    if (id) ourEvents.add(id);
    return id;
  },
  async owner(body) {
    const desk = owner.owner_desk_room;
    if (!desk) return null;
    if (process.env.CK_POST_OWNER !== '1' || (listenPrefixes && !allowed(desk))) { console.log(`[dry-run owner desk] ${body}`); return null; }
    await op(desk, 'connect_to_room', { room_id: desk });
    const id = eventIdOf(await op(desk, 'post_message', { body }));
    if (id) ourEvents.add(id);
    return id;
  },
};

const selfSenders = new Set((process.env.CK_SELF_SENDERS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
let stopped = false;
const deps: Deps = {
  claude: realClaude(), cfg: modelConfigFromEnv(), system: systemPrompt('.'), poster,
  state: new AgentState(`${SD}/agent-state.json`), selfSenders,
  ownerSender: owner.owner_sender ?? null, ownerName: process.env.CK_OWNER_NAME || 'Kash', pending: new PendingStore(`${SD}/pending.json`),
  onFatal: (why) => { stopped = true; console.error('fatal, stopping:', why); setTimeout(() => process.exit(2), 2000); },
};

const features = featuresFromEnv();
const rememberRoom = (r: { id: string; name: string }) => {
  roomNames.set(r.id, r.name);
  atomicWriteJson(roomsFile, [...new Set([...readJson<string[]>(roomsFile, []), r.id])]); // declared at open after a restart
  op(r.id, 'connect_to_room', { room_id: r.id }).then(() => console.log(`listening in ${r.name}${allowed(r.id) ? ' (posting on)' : ' (dry-run)'}`), (e) => console.error(`connect to ${r.name} failed:`, e.message));
};
// Job E: the same op(), guards and owner desk as everything else. CK_BUILD_ROOM must match CK_POST_ROOMS to be created.
const handoff = features.jobE ? handoffFromEnv({
  op, selfSenders,
  canPost: allowed,
  canCreate: (name) => postPrefixes.some((p) => name.startsWith(p)),
  onRoom: rememberRoom,
  owner: (body) => poster.owner(body),
  ownerSender: owner.owner_sender ?? null,
  ownerUsername: process.env.CK_OWNER_HANDLE || ownerFile.owner_handle || null,
  ownerDeskRoom: owner.owner_desk_room ?? null,
  file: `${SD}/handoff.json`,
}) : null;
const handles = new HandleMemo();
if (handoff) setInterval(() => { if (!stopped) handoff.tick().catch((e) => console.error('job E tick:', e.message)); }, 60_000).unref();

// Job C's voice half: the audio clip and the "talk it through" link. No key → text only.
let eleven = null;
if (features.audioBrief || features.talkLink) {
  try { eleven = realEleven(); } catch (e) { console.warn(`voice off: ${(e as Error).message}`); }
}
const voice = eleven ? new VoiceLive({
  claude: deps.claude, el: eleven, poster, state: deps.state, audio: features.audioBrief, talk: features.talkLink,
  media: (roomId) => {
    if (!sessions.has(roomId)) sessions.set(roomId, randomUUID());
    return realSwitchMedia({ endpoint, agentId, token, connectionId, sessionId: sessions.get(roomId)! });
  },
  callsFile: `${SD}/voice-calls.json`,
  saveDir: process.env.CK_VOICE_SAVE_DIR || 'build/voice/live',
  // While a talk link is open, tick() keeps the talk agent on the room's live record (no Switch call:
  // the record as RoomMemory holds it). `memory` is declared below; this only runs from tick().
  recordOf: (roomId) => memory.cached(roomId),
  // Job E's ideas from that room, in plain words ("being built by Claude Code"), read from its store's
  // file (read-only). A status change counts as a record change.
  ...(handoff ? { ideasOf: (roomId: string) => readTalkIdeas(`${SD}/handoff.json`, roomId, deps.ownerName) } : {}),
  // The live whats_new tool, through the cloudflared tunnel Kash starts (docs/handoff-live-test.md §3).
  // No tunnel URL (CK_TALK_TOOL_URL or tunnel.log), or it stops answering → no tool, refresh-on-change.
  tool: { url: () => tunnelUrl(), secret: toolSecret(process.env, `${SD}/talk-tool-secret`) },
  log: (s) => console.log(s),
}) : null;
if (voice && features.talkLink && voice.talkAgentId()) {
  const port = Number(process.env.CK_TALK_TOOL_PORT || TOOL_PORT);
  startToolServer({ port, secret: toolSecret(process.env, `${SD}/talk-tool-secret`), answer: (req) => voice.answerWhatsNew(req), log: (s) => console.log(`[voice] ${s}`) })
    .then(() => console.log(`[voice] whats_new tool server on 127.0.0.1:${port}; tunnel it with: cloudflared tunnel --no-autoupdate --url http://127.0.0.1:${port} > tunnel.log 2>&1 &`))
    .catch((e) => console.error(`[voice] whats_new tool server not started (${(e as Error).message}); refresh-on-change only`))
    .finally(() => { void voice.syncTool(); });
}
if (voice && features.talkLink) setInterval(() => { if (!stopped) voice.tick().catch((e) => console.error('voice tick:', e.message)); }, 60_000).unref();
console.log(`features: job E ${handoff ? 'on' : 'off'}, audio brief ${voice && features.audioBrief ? 'on' : 'off'}, talk link ${voice?.talkAgentId() ? 'on' : 'off'}`);

// The record per room, from Switch (loaded on the room's first message, refreshed before each decision).
const selfNames = new Set<string>();
const unwrap = (r: any) => (r && typeof r === 'object' && 'result' in r ? r.result : r);
const memory = new RoomMemory({
  op: async (roomId, name, args) => unwrap(await op(roomId, name, args)),
  agentId, selfNames: () => selfNames, selfSenders, displayName,
  canWrite: (roomId) => allowed(roomId),
});
deps.onDecisionLogged = (d) => memory.logDecision(d);
const recordFor = (roomId: string): Promise<RoomRecord | null> => memory.record(roomId, roomNames.get(roomId) ?? roomId);

// Per-author quiet gap: one decision per person's burst, never per thread.
// The stream position moves past a message as soon as it's queued, so the queue is saved too
// (state/agent-buffer.json): a restart inside the quiet gap re-queues it instead of dropping it.
const buffers = new Map<string, { inputs: Input[]; timer: NodeJS.Timeout; first: number }>();
const bufFile = `${SD}/agent-buffer.json`;
// Read now, not once the rooms are joined: catch-up events arrive first and would overwrite the file.
let carried = readJson<{ room: string; inputs: Input[] }[]>(bufFile, []);
const saveBuffers = () => atomicWriteJson(bufFile, [...carried, ...[...buffers.entries()].map(([k, b]) => ({ room: k.slice(0, k.indexOf('|')), inputs: b.inputs }))]);
function enqueue(roomId: string, input: Input) {
  const key = `${roomId}|${input.sender}`;
  const b = buffers.get(key);
  if (b?.inputs.some((i) => i.message_id === input.message_id)) return;
  if (b) clearTimeout(b.timer);
  const entry = b ?? { inputs: [], timer: undefined as unknown as NodeJS.Timeout, first: Date.now() };
  entry.inputs.push(input);
  const wait = Math.max(0, Math.min(gapMs, entry.first + CAP_MS - Date.now()));
  entry.timer = setTimeout(() => { buffers.delete(key); saveBuffers(); void run(roomId, entry.inputs); }, wait);
  buffers.set(key, entry);
  saveBuffers();
}

async function run(roomId: string, inputs: Input[]) {
  if (stopped) return;
  const rec = await recordFor(roomId);
  if (!rec) { console.log(`no record for room ${roomNames.get(roomId) ?? roomId}: it has no room documents in Switch; skipping (seed it with npm run seed)`); return; }
  try {
    await memory.refresh(roomId);
    const ctx = buildRoomContext(rec);
    const results = await decideWithRetry(deps, roomId, roomNames.get(roomId) ?? roomId, ctx, inputs);
    for (const r of results) if (r.trace) console.log(`decision ${r.trace.decision_id}: ${r.trace.kind} ${r.trace.items.map((i) => `${i.message_id}=${i.job}/${i.verdict ?? '-'}`).join(' ')}${r.trace.error ? ` (${r.trace.error})` : ''}`);
    if (handoff) {
      try {
        const refs = await noteNewIdeas(handoff, roomId, roomNames.get(roomId) ?? roomId, inputs, results, handles);
        if (refs.length) console.log(`job E: noted ${refs.join(', ')} for the owner`);
      } catch (e) { console.error('job E note failed:', (e as Error).message); }
    }
  } catch (e) {
    // A crash becomes a note, never a dead loop.
    console.error('decision crashed:', (e as Error).message);
    try { await poster.owner(`Couldn't check this one (crash): ${inputs[0].message_id} in ${roomNames.get(roomId)}`); } catch { /* logged above */ }
  }
}

async function onEvent(ev: AgentBridgeEvent) {
  if (ev.type.includes('join')) {
    const j = ev.payload as RoomJoinPayload;
    if (j.member && ev.room_id !== owner.owner_desk_room && j.member !== owner.owner_sender && !selfSenders.has(j.member)) deps.state.markJoined(ev.room_id, j.member);
    return;
  }
  if (ev.type !== 'message') return;
  const m = ev.payload as MessagePayload;
  if (ourEvents.has(m.message_id)) { selfSenders.add(m.sender); return; } // learn our own sender id from our own post
  // Switch's "📄 updated room document" notice for our own Decision log write, in our name: not chat.
  if (isDocNotice(m.body ?? '') && selfNames.has(m.sender_name ?? '')) { selfSenders.add(m.sender); return; }
  if (selfSenders.has(m.sender)) return;
  if (deps.state.isProcessed(ev.room_id, m.message_id)) return; // a resumed stream can redeliver the last message
  const who = await displayName(m.sender, m.sender_name);
  const at = new Date(m.timestamp).toISOString();
  const input: Input = { message_id: m.message_id, sender: m.sender, sender_name: who, body: m.body, received_at: at, thread_id: m.thread_id ?? null };
  // Job E first: "approve I<n>" in the owner desk, anything in a build room (Claude Code's report), and
  // the raiser's sign-off in the original thread. Everything else falls through to jobs A to D.
  if (handoff && !stopped) {
    handles.set(m.message_id, m.sender_name);
    try {
      if (await handoff.onMessage(toHandoffMsg(ev.room_id, roomNames.get(ev.room_id) ?? ev.room_id, m, who, at))) {
        // Job E's (a sign-off in the idea's thread, say), but still part of the room's record, so the
        // talk agent hears it. addLive ignores rooms with no record (build rooms).
        if (ev.room_id !== owner.owner_desk_room) memory.addLive(ev.room_id, { id: m.message_id, at, author: who, text: m.body, thread: m.thread_id ?? null });
        return;
      }
    } catch (e) { console.error('job E handler crashed:', (e as Error).message); }
  }
  if (ev.room_id === owner.owner_desk_room) {
    if (stopped) return;
    try {
      const t = await handleOwnerDesk(deps, ev.room_id, 'owner desk', input);
      if (t) console.log(`owner desk ${t.decision_id}: ${t.kind}${t.error ? ` (${t.error})` : ''}`);
    } catch (e) { console.error('owner desk handler crashed:', (e as Error).message); }
    return;
  }
  const rec = await recordFor(ev.room_id);
  const live = { id: m.message_id, at, author: who, text: m.body, thread: m.thread_id ?? null };
  // Another agent's post (Claude Code's, say) is room context, never a proposal (PR11).
  if ((m.sender_kind && m.sender_kind !== 'user') || isAgentSender(m.sender)) { memory.addLive(ev.room_id, live); return; }
  // Job C first: a joiner's or returner's first message gets the brief, then job A answers it.
  const trig = rec && !stopped ? briefTrigger(deps, ev.room_id, rec, input) : null;
  memory.addLive(ev.room_id, live);
  if (trig && rec) {
    const roomName = roomNames.get(ev.room_id) ?? ev.room_id;
    // The text brief goes first and job A waits for it; the audio clip follows in the background, and
    // the brief's trace line (written once the clip is done) carries both posts.
    let textDone!: () => void;
    const textPosted = new Promise<void>((r) => { textDone = r; });
    const opts: BriefOpts = {};
    const v = voice && allowed(ev.room_id) ? voice : null; // a dry-run room gets no clip and no link (nothing paid for)
    try {
      const talk = v ? await v.talkClosing(rec, roomName, who, ev.room_id) : null;
      if (talk) opts.closing = talk.closing;
      if (v) opts.after = async ({ threadId, briefText }) => {
        textDone();
        return v.afterBrief({ roomId: ev.room_id, roomName, threadId, messageId: m.message_id, person: who, since: trig.since, briefText, talk: talk?.talk ?? null });
      };
    } catch (e) { console.error('voice prep failed:', (e as Error).message); }
    Promise.resolve()
      .then(() => runBrief(deps, ev.room_id, roomName, buildRoomContext(rec), input, trig, opts))
      .then((t) => console.log(`brief ${t.decision_id} for ${who} (${trig.kind}): ${t.kind}${t.posts.length > 1 ? ` + ${t.posts.length - 1} voice post(s)` : ''}${t.error ? ` (${t.error})` : ''}`))
      .catch((e) => console.error('brief crashed:', (e as Error).message))
      .finally(() => textDone());
    await textPosted;
  }
  enqueue(ev.room_id, input);
}

async function joinRooms() {
  const me = unwrap(await op(null, 'get_my_context', {}).catch(() => null));
  if (me?.you?.name) selfNames.add(me.you.name);
  const rooms = ((await op(null, 'list_rooms', {})) as { result: { room_id: string; name: string; archived: boolean }[] }).result;
  const live = rooms.filter((x) => !x.archived && (!listenPrefixes || listenPrefixes.some((p) => x.name.startsWith(p))));
  atomicWriteJson(roomsFile, live.map((r) => r.room_id));
  for (const r of live) {
    roomNames.set(r.room_id, r.name);
    await op(r.room_id, 'connect_to_room', { room_id: r.room_id });
    console.log(`listening in ${r.name}${allowed(r.room_id) ? ' (posting on)' : ' (dry-run)'}`);
    await joinEventsOn(r.room_id, r.name);
  }
}

// No room_join events (job C's trigger) until the agent asks, even in a room it's already in; the
// seed and the eval ask at create time, this covers rooms that someone else made.
let myName: string | null = null;
async function joinEventsOn(roomId: string, name: string) {
  try {
    myName ??= ((r) => r?.result?.you?.name ?? r?.you?.name ?? null)(await op(null, 'get_my_context', {}));
    if (!myName) return;
    const d = await op(null, 'get_room_detail', { room_id: roomId });
    if (((d?.result ?? d)?.join_event_listeners ?? []).includes(myName)) return;
    await op(roomId, 'update_room', { room_id: roomId, join_event_listeners: { [myName]: true } }); // a map here, a list in create_room
    console.log(`join events on in ${name}`);
  } catch (e) { console.warn(`join events in ${name}: ${(e as Error).message}`); }
}

let resumed = false;
const saved = readJson<Record<string, number> | null>(posFile, null);
// Logs leave before the process does: a bare process.exit() right after console.error can cut the line
// off on a pipe (the eval's agent.log, journald).
const exitSoon = (code: number, why: string) => { stopped = true; console.error(why); setTimeout(() => process.exit(code), 500); };
// The rooms the server says this connection covers, so a fresh stream declares them at open.
let serverRooms: string[] = [];
let stream: SwitchEventStream | null = null;
const watchdogMs = watchdogMsFromEnv(process.env.CK_STREAM_WATCHDOG_SEC);
// One stream at a time; the watchdog replaces a quiet one with a fresh one from where the old one had
// read to (its in-memory position, else the saved file). Callbacks from a replaced stream are ignored.
function openStream(): StreamHandle {
  const ac = new AbortController();
  const prev = stream?.position;
  const startPosition = prev && Object.keys(prev).length ? prev : saved;
  const rooms = [...new Set([...readJson<string[]>(roomsFile, []), ...serverRooms])];
  const s: SwitchEventStream = new SwitchEventStream({
    creds: { agentId, apiEndpoint: endpoint, token },
    connectionId,
    scope: 'all',
    filter: 'all',
    rooms, // declared at open, so catch-up covers them
    ...(startPosition ? { startPosition } : {}),
    onAlive: () => { if (stream === s) watchdog?.alive(); },
    onEvent: async (ev) => { if (stream === s) await onEvent(ev).catch((e) => console.error('handler failed:', e.message)); },
    onRooms: (r) => { if (stream === s && r.length) serverRooms = r; },
    onConnected: () => {
      if (stream !== s) return;
      watchdog?.alive();
      console.log('connected');
      joinRooms()
        .then(() => {
          // Once per process, after the rooms are joined: re-queue what a restart caught inside the quiet
          // gap (already-decided ids are skipped by the pipeline), then finish a hand-off a restart
          // interrupted (a step caught mid-send is never re-sent). Not on a reconnect.
          if (resumed) return;
          resumed = true;
          const queued = carried;
          carried = [];
          for (const q of queued) for (const i of q.inputs) enqueue(q.room, i);
          if (queued.length) console.log(`re-queued ${queued.reduce((n, q) => n + q.inputs.length, 0)} message(s) from before the restart`);
          return handoff?.resume();
        })
        .catch((e) => console.error('joining rooms failed:', e.message));
    },
    // Every ending the runtime reconnects from (it waits, then reopens from its position).
    onDisconnected: ({ error }) => { if (stream === s) console.warn(`disconnected: ${error}; reconnecting`); },
    onGap: (g) => {
      if (stream !== s) return;
      console.warn('gap: re-reading room history with read_context', g);
      for (const r of memory.roomIds()) void memory.rereadHistory(r).then((n) => n && console.log(`memory: ${roomNames.get(r)}: ${n} missed message(s) added from read_context`));
    },
    // heartbeat_lapsed (no pong for 6 s: a stalled event loop, a paused process, a sleeping machine) and
    // closed are recoverable: Switch closes the socket and the runtime reopens and resumes. Only a
    // takeover (another process holds this connection id) and rejected credentials are final, and the
    // runtime has already stopped for those. This used to exit on every eviction, a lapse included.
    onEvicted: (e) => {
      if (stream !== s) return;
      if (e.code === EVICTION_TAKEN_OVER || e.code === EVICTION_CREDENTIALS_REJECTED) { exitSoon(3, `evicted (${e.code}): ${e.reason}; stopping`); return; }
      console.warn(`evicted (${e.code}${e.roomId ? `, room ${roomNames.get(e.roomId) ?? e.roomId}` : ''}): ${e.reason}; the stream reconnects and resumes`);
    },
    log: {
      debug: () => {},
      warn: (m: string, meta?: Record<string, unknown>) => { if (stream === s) console.warn(meta ? `${m} ${JSON.stringify(meta)}` : m); },
      error: (m: string, meta?: Record<string, unknown>) => { if (stream === s) console.error(meta ? `${m} ${JSON.stringify(meta)}` : m); },
    },
    signal: ac.signal,
  });
  stream = s;
  s.start();
  return { stop: () => ac.abort() };
}
const watchdog: StreamWatchdog | null = watchdogMs === null ? null : new StreamWatchdog({
  staleMs: watchdogMs, maxRestarts: DEFAULT_MAX_RESTARTS, now: Date.now, open: openStream,
  log: (l) => console.warn(l),
  giveUp: () => { save(); exitSoon(4, 'exiting (code 4) so the supervisor restarts the agent'); },
});
if (watchdog && watchdogMs !== null) {
  watchdog.start();
  setInterval(() => { if (!stopped) watchdog.check(); }, Math.min(15_000, Math.max(1000, watchdogMs / 4)));
  console.log(`stream watchdog on: a fresh stream after ${watchdogMs / 1000} s with no event, ping or heartbeat`);
} else openStream();
let last = '';
function save() { if (!stream) return; const pos = stream.position; const p = JSON.stringify(pos); if (p !== last && p !== '{}') { atomicWriteJson(posFile, pos); last = p; } }
setInterval(save, 1000);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { save(); process.exit(0); });
