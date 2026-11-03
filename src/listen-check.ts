// listen-check: the first proof that Context Keeper hears the room.
// Connects as the agent, reads every message (not only ones that tag it), logs each to
// state/trace.jsonl, and answers an untagged human message with a short thread reply.
// Run: npx tsx src/listen-check.ts   (reads .env and .env.local; scripts/server-up.sh writes the latter)
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { displayName } from './names.ts';
import { SwitchEventStream, type AgentBridgeEvent, type MessagePayload } from '../vendor/switch-agent-runtime/src/index.ts';

function loadEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
loadEnv('.env');
loadEnv('.env.local');

const need = (k: string) => process.env[k] || (console.error(`missing ${k} (run scripts/server-up.sh)`), process.exit(1));
const endpoint = need('SWITCH_API_URL');
const agentId = need('SWITCH_AGENT_ID');
const token = need('SWITCH_AGENT_API_KEY');

mkdirSync('state', { recursive: true });
const idFile = 'state/connection-id';
const connectionId = existsSync(idFile) ? readFileSync(idFile, 'utf8').trim() : randomUUID();
writeFileSync(idFile, connectionId);
const sessionByRoom = new Map<string, string>(); // one session id per room (lets us hold several rooms at once)
const seen = new Set<string>();

const trace = (rec: Record<string, unknown>) =>
  appendFileSync('state/trace.jsonl', JSON.stringify({ t: new Date().toISOString(), ...rec }) + '\n');

async function op(roomId: string, name: string, args: Record<string, unknown>) {
  let session = sessionByRoom.get(roomId);
  if (!session) sessionByRoom.set(roomId, (session = randomUUID()));
  const res = await fetch(`${endpoint}/agents/${agentId}/ops/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Switch-Connection-Id': connectionId,
      'X-Switch-Session-Id': session,
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text.slice(0, 300)}`);
  return text;
}

async function onEvent(ev: AgentBridgeEvent) {
  if (ev.type !== 'message') {
    trace({ kind: ev.type, room: ev.room_id });
    console.log(`[${ev.type}] room ${ev.room_id}`);
    return;
  }
  const m = ev.payload as MessagePayload;
  if (seen.has(m.message_id)) return; // a resumed stream can redeliver the last message
  seen.add(m.message_id);
  const who = await displayName(m.sender, m.sender_name); // "Rowan", not the handle "cosmicboard"
  trace({ kind: 'message', room: ev.room_id, id: m.message_id, from: who, handle: m.sender_name, sender: m.sender,
          sender_kind: m.sender_kind ?? null, addressed: m.addressed, thread: m.thread_id ?? null, body: m.body });
  console.log(`[message] ${who} (${m.sender_kind ?? 'person'}, addressed=${m.addressed}): ${m.body}`);

  const fromPerson = !m.sender_kind || m.sender_kind === 'user';
  if (!fromPerson || m.addressed || !m.body.trim()) return;
  await op(ev.room_id, 'connect_to_room', { room_id: ev.room_id });
  await op(ev.room_id, 'post_message', {
    body: `Heard you, ${who}, without being tagged. (listen check)`,
    thread_id: m.message_id,
  });
  trace({ kind: 'replied', room: ev.room_id, to: m.message_id });
  console.log('  -> replied in the thread');
}

async function joinRooms() {
  const res = await fetch(`${endpoint}/agents/${agentId}/ops/list_rooms`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Switch-Connection-Id': connectionId },
    body: '{}',
  });
  const rooms = ((await res.json()) as { result: { room_id: string; name: string; archived: boolean }[] }).result;
  for (const r of rooms.filter((r) => !r.archived)) {
    await op(r.room_id, 'connect_to_room', { room_id: r.room_id });
    console.log(`listening in ${r.name} (${r.room_id})`);
  }
}

const log = {
  debug: () => {},
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn('warn', msg, meta ?? ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error('error', msg, meta ?? ''),
};
const abort = new AbortController();
process.on('SIGINT', () => abort.abort());

new SwitchEventStream({
  creds: { agentId, apiEndpoint: endpoint, token },
  connectionId,
  scope: 'all',
  filter: 'all',
  rooms: [],
  onEvent: (ev) => onEvent(ev).catch((e) => console.error('handler failed:', e.message)),
  onRooms: (rooms) => console.log('covering rooms:', rooms.join(', ') || '(none)'),
  // The stream opens with no rooms; claim every room we've been invited to, so their messages flow.
  onConnected: () => {
    console.log('connected as context-keeper');
    joinRooms().catch((e) => console.error('joining rooms failed:', e.message));
  },
  onDisconnected: ({ error }) => console.warn('disconnected:', error),
  onGap: (g) => console.warn('gap:', g),
  onEvicted: (e) => console.warn('evicted:', e),
  log,
  signal: abort.signal,
}).start();
