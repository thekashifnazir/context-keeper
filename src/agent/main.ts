// main: the live Context Keeper (jobs A, B, C text, D). Listens to every room it's in (untagged), batches each
// person's messages until they go quiet (CK_BURST_GAP_S, 90 s hard cap), runs the pipeline, and
// saves its stream position so a restart resumes instead of dropping what came in meanwhile.
//   npx tsx src/agent/main.ts
// Safety while other lanes are live: it only posts into rooms whose name starts with one of
// CK_POST_ROOMS (default "ck-smoke-,ck-eval-"); everywhere else it decides, traces and logs the
// draft, but sends nothing. The owner desk gets posts only with CK_POST_OWNER=1.
// Room record: until the seed lane's room documents land, the record is demo/<room> (chosen by
// CK_ROOM_DEMO, or by "ledgerly"/"riverside" in the room name) plus every live message as it arrives.
// Owner desk (state/owner.json, or CK_OWNER_SENDER / CK_OWNER_DESK_ROOM): its messages never go to
// job A; the owner's text reply there confirms a decision (B) or rules on a clash (D). A room_join
// (Switch sends it just before the person's first message) marks them for a catch-up brief (C).
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { SwitchEventStream, type AgentBridgeEvent, type MessagePayload } from '../../vendor/switch-agent-runtime/src/index.ts';
import type { RoomJoinPayload } from '../../vendor/switch-agent-runtime/src/types.ts';
import { displayName } from '../names.ts';
import { buildRoomContext } from './blocks.ts';
import { briefTrigger, runBrief } from './jobs/brief.ts';
import { handleOwnerDesk } from './owner-desk.ts';
import { PendingStore } from './pending.ts';
import { loadEnv } from './env.ts';
import { modelConfigFromEnv, realClaude } from './model.ts';
import { decideWithRetry, type Deps, type Input } from './pipeline.ts';
import type { Poster } from './post.ts';
import { systemPrompt } from './prompt.ts';
import { loadDemoRoom, type RoomRecord } from './room.ts';
import { AgentState, atomicWriteJson } from './state.ts';

loadEnv();
const need = (k: string) => process.env[k] || (console.error(`missing ${k}`), process.exit(1));
const endpoint = need('SWITCH_API_URL');
const agentId = need('SWITCH_AGENT_ID');
const token = need('SWITCH_AGENT_API_KEY');
mkdirSync('state', { recursive: true });

const readJson = <T,>(f: string, d: T): T => { try { return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : d; } catch { return d; } };
const idFile = 'state/agent-connection.json';
const connectionId = readJson<{ id?: string }>(idFile, {}).id ?? randomUUID();
atomicWriteJson(idFile, { id: connectionId });
const posFile = 'state/agent-position.json';
const roomsFile = 'state/agent-rooms.json';
const ownerFile = readJson<{ owner_desk_room?: string; owner_sender?: string }>('state/owner.json', {});
const owner = { owner_desk_room: process.env.CK_OWNER_DESK_ROOM || ownerFile.owner_desk_room, owner_sender: process.env.CK_OWNER_SENDER || ownerFile.owner_sender };
const postPrefixes = (process.env.CK_POST_ROOMS ?? 'ck-smoke-,ck-eval-').split(',').map((s) => s.trim()).filter(Boolean);
const gapMs = Number(process.env.CK_BURST_GAP_S ?? 20) * 1000;
const CAP_MS = 90_000;

const sessions = new Map<string, string>();
async function op(roomId: string | null, name: string, args: Record<string, unknown>): Promise<any> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Switch-Connection-Id': connectionId };
  if (roomId) {
    if (!sessions.has(roomId)) sessions.set(roomId, randomUUID());
    headers['X-Switch-Session-Id'] = sessions.get(roomId)!;
  }
  const res = await fetch(`${endpoint}/agents/${agentId}/ops/${name}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const roomNames = new Map<string, string>();
const allowed = (roomId: string) => postPrefixes.some((p) => (roomNames.get(roomId) ?? '').startsWith(p));
const ourEvents = new Set<string>();
const eventIdOf = (r: any): string | null => r?.result?.message_id ?? r?.result?.event_id ?? r?.message_id ?? r?.event_id ?? null;

const poster: Poster = {
  ownerRoom: owner.owner_desk_room ? { id: owner.owner_desk_room, name: 'owner desk' } : null,
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
    if (process.env.CK_POST_OWNER !== '1') { console.log(`[dry-run owner desk] ${body}`); return null; }
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
  state: new AgentState('state/agent-state.json'), selfSenders,
  ownerSender: owner.owner_sender ?? null, ownerName: process.env.CK_OWNER_NAME || 'Kash', pending: new PendingStore('state/pending.json'),
  onFatal: (why) => { stopped = true; console.error('fatal, stopping:', why); setTimeout(() => process.exit(2), 2000); },
};

// The record per room: demo content plus live messages as they arrive.
const records = new Map<string, RoomRecord>();
function recordFor(roomId: string): RoomRecord | null {
  if (records.has(roomId)) return records.get(roomId)!;
  const name = roomNames.get(roomId) ?? '';
  const demo = process.env.CK_ROOM_DEMO || (name.includes('riverside') ? 'riverside-build-night' : name.includes('ledgerly') ? 'ledgerly-pilot' : '');
  if (!demo) return null;
  const rec = { ...loadDemoRoom('.', demo), name };
  records.set(roomId, rec);
  return rec;
}

// Per-author quiet gap: one decision per person's burst, never per thread.
const buffers = new Map<string, { inputs: Input[]; timer: NodeJS.Timeout; first: number }>();
function enqueue(roomId: string, input: Input) {
  const key = `${roomId}|${input.sender}`;
  const b = buffers.get(key);
  if (b) clearTimeout(b.timer);
  const entry = b ?? { inputs: [], timer: undefined as unknown as NodeJS.Timeout, first: Date.now() };
  entry.inputs.push(input);
  const wait = Math.max(0, Math.min(gapMs, entry.first + CAP_MS - Date.now()));
  entry.timer = setTimeout(() => { buffers.delete(key); void run(roomId, entry.inputs); }, wait);
  buffers.set(key, entry);
}

async function run(roomId: string, inputs: Input[]) {
  if (stopped) return;
  const rec = recordFor(roomId);
  if (!rec) { console.log(`no record for room ${roomNames.get(roomId) ?? roomId}; skipping`); return; }
  try {
    const ctx = buildRoomContext(rec);
    const results = await decideWithRetry(deps, roomId, roomNames.get(roomId) ?? roomId, ctx, inputs);
    for (const r of results) if (r.trace) console.log(`decision ${r.trace.decision_id}: ${r.trace.kind} ${r.trace.items.map((i) => `${i.message_id}=${i.job}/${i.verdict ?? '-'}`).join(' ')}${r.trace.error ? ` (${r.trace.error})` : ''}`);
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
  if (selfSenders.has(m.sender)) return;
  const who = await displayName(m.sender, m.sender_name);
  const at = new Date(m.timestamp).toISOString();
  const input: Input = { message_id: m.message_id, sender: m.sender, sender_name: who, body: m.body, received_at: at, thread_id: m.thread_id ?? null };
  if (ev.room_id === owner.owner_desk_room) {
    if (stopped) return;
    try {
      const t = await handleOwnerDesk(deps, ev.room_id, 'owner desk', input);
      if (t) console.log(`owner desk ${t.decision_id}: ${t.kind}${t.error ? ` (${t.error})` : ''}`);
    } catch (e) { console.error('owner desk handler crashed:', (e as Error).message); }
    return;
  }
  const rec = recordFor(ev.room_id);
  if (m.sender_kind && m.sender_kind !== 'user') { rec?.messages.push({ id: m.message_id, at, author: who, text: m.body, thread: m.thread_id ?? null }); return; }
  // Job C first: a joiner's or returner's first message gets the brief, then job A answers it.
  const trig = rec && !stopped ? briefTrigger(deps, ev.room_id, rec, input) : null;
  rec?.messages.push({ id: m.message_id, at, author: who, text: m.body, thread: m.thread_id ?? null });
  if (trig && rec) {
    try {
      const t = await runBrief(deps, ev.room_id, roomNames.get(ev.room_id) ?? ev.room_id, buildRoomContext(rec), input, trig);
      console.log(`brief ${t.decision_id} for ${who} (${trig.kind}): ${t.kind}${t.error ? ` (${t.error})` : ''}`);
    } catch (e) { console.error('brief crashed:', (e as Error).message); }
  }
  enqueue(ev.room_id, input);
}

async function joinRooms() {
  const rooms = ((await op(null, 'list_rooms', {})) as { result: { room_id: string; name: string; archived: boolean }[] }).result;
  const live = rooms.filter((x) => !x.archived);
  atomicWriteJson(roomsFile, live.map((r) => r.room_id));
  for (const r of live) {
    roomNames.set(r.room_id, r.name);
    await op(r.room_id, 'connect_to_room', { room_id: r.room_id });
    console.log(`listening in ${r.name}${allowed(r.room_id) ? ' (posting on)' : ' (dry-run)'}`);
  }
}

const saved = readJson<Record<string, number> | null>(posFile, null);
const stream = new SwitchEventStream({
  creds: { agentId, apiEndpoint: endpoint, token },
  connectionId,
  scope: 'all',
  filter: 'all',
  rooms: readJson<string[]>(roomsFile, []), // declared at open, so catch-up covers them
  ...(saved ? { startPosition: saved } : {}),
  onEvent: (ev) => onEvent(ev).catch((e) => console.error('handler failed:', e.message)),
  onRooms: () => {},
  onConnected: () => { console.log('connected'); joinRooms().catch((e) => console.error('joining rooms failed:', e.message)); },
  onDisconnected: ({ error }) => console.warn('disconnected:', error),
  onGap: (g) => console.warn('gap (re-read the room with read_context):', g),
  onEvicted: (e) => { console.error('evicted:', e); process.exit(3); },
  log: { debug: () => {}, warn: (m: string) => console.warn(m), error: (m: string) => console.error(m) },
  signal: new AbortController().signal,
});
stream.start();
let last = '';
const save = () => { const p = JSON.stringify(stream.position); if (p !== last && p !== '{}') { atomicWriteJson(posFile, stream.position); last = p; } };
setInterval(save, 1000);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { save(); process.exit(0); });
