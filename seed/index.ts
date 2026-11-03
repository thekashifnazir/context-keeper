// seed: one command turns a fresh room into the demo room.
//   npm run seed -- --bridge mattermost|slack|discord|internal [--demo ledgerly|riverside]
//                   [--room-name <name> | --room <existing room id>] [--owner-username <name>]
//                   [--owner-desk-room <id>] [--emit-templates]
// It creates (or takes) the room with the room rules as its instructions and join events on for the
// agent, adds the seed documents and the "Channel archive" as room documents (owned by the agent),
// and makes the private owner desk (channel_private, only the owner and the agent). It posts no chat
// message. The agent creates its own Decision log when it starts (design §6.5).
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DEMOS, type Demo, DESK_INSTRUCTIONS, demoContent, roomInstructions } from './content.ts';
import { type Bridge, credsFromEnv, loadDotenv, OpError, type RoomSummary, SwitchSession } from './switch.ts';
import { writeTemplates } from './template.ts';

const BRIDGE_TYPES = ['mattermost', 'slack', 'discord', 'internal'] as const;
// Rooms the seed must never write into without an explicit override (the live demo channels).
const PROTECTED = /ledgerly-pilot$|event-planning$|ck-owner-desk$|ledgerly-build$/;

interface RoomDetail {
  id: string;
  name: string;
  channel_type: string | null;
  instructions: string | null;
  bridge_id: string | null;
  bridge_display_name: string | null;
  agent_names: string[];
  connected_user_names: string[];
  join_event_listeners?: string[];
  archived?: boolean;
}

const { values: args } = parseArgs({
  options: {
    bridge: { type: 'string' },
    'bridge-id': { type: 'string' },
    demo: { type: 'string', default: 'ledgerly' },
    'room-name': { type: 'string' },
    room: { type: 'string' },
    'owner-username': { type: 'string' },
    'owner-desk-room': { type: 'string' },
    'demo-room-ok': { type: 'boolean', default: false },
    'emit-templates': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const t0 = Date.now();
const say = (s: string) => console.log(s);
function die(msg: string): never {
  console.error(`seed: FAILED: ${msg}`);
  process.exit(1);
}

if (args.help) {
  say(readUsage());
  process.exit(0);
}
if (!DEMOS.includes(args.demo as Demo)) die(`--demo must be one of ${DEMOS.join(', ')}`);
const demo = args.demo as Demo;

if (args['emit-templates']) {
  for (const f of writeTemplates()) say(`wrote ${f}`);
  process.exit(0);
}
if (args.bridge && !BRIDGE_TYPES.includes(args.bridge as (typeof BRIDGE_TYPES)[number]))
  die(`--bridge must be one of ${BRIDGE_TYPES.join(', ')}`);
if (args.room && args['room-name']) die('pass --room (seed an existing room) or --room-name (create one), not both');

loadDotenv();
const creds = credsFromEnv() ?? die('SWITCH_API_URL, SWITCH_AGENT_ID or SWITCH_AGENT_API_KEY missing (.env / .env.local; run scripts/server-up.sh)');
const content = demoContent(demo);

let sw: SwitchSession | undefined;
try {
  sw = await SwitchSession.open(creds);
  await seed(sw);
  say(`seed OK in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) {
  if (e instanceof OpError) die(`${e.op} returned HTTP ${e.status}${e.fatal ? ' (stopping: auth or not found)' : ''}: ${e.detail.slice(0, 300)}`);
  die((e as Error).message);
} finally {
  sw?.close();
}
process.exit(0);

async function seed(sw: SwitchSession) {
  const me = await sw.op<{ you: { name: string }; messaging_apps?: { connected?: { id: string; your_usernames?: string[] }[] } }>('get_my_context');
  const agent = me.you.name;

  // 1. Which bridge.
  let bridge: Bridge | null = null;
  if (args.bridge !== 'internal') {
    const bridges = (await sw.op<Bridge[]>('list_bridges')).filter((b) => b.status === 'active');
    if (args['bridge-id']) bridge = bridges.find((b) => b.id === args['bridge-id']) ?? die(`no active bridge with id ${args['bridge-id']}`);
    else if (args.bridge) {
      const ofType = bridges.filter((b) => b.type === args.bridge);
      bridge = ofType.find((b) => b.is_default) ?? ofType[0] ?? die(`no active ${args.bridge} bridge (have: ${bridges.map((b) => b.type).join(', ') || 'none'})`);
    } else bridge = bridges.find((b) => b.is_default) ?? die('no default bridge; pass --bridge');
    say(`bridge: ${bridge.type} "${bridge.display_name}" (${bridge.id})`);
  } else say('bridge: none (internal-only room)');

  // 2. Who owns it: the flag, else the owner's username on that messaging app.
  const linked = bridge && me.messaging_apps?.connected?.find((c) => c.id === bridge!.id)?.your_usernames?.[0];
  const owner = args['owner-username'] ?? linked ?? die('no --owner-username, and the owner has no linked account on this bridge');
  say(`owner: ${owner}${args['owner-username'] ? '' : ' (from get_my_context)'}`);

  // 3. The room: take an existing one, or create a fresh one.
  const instructions = roomInstructions(owner);
  let room: RoomDetail;
  if (args.room) {
    room = await sw.op<RoomDetail>('get_room_detail', { room_id: args.room });
    if (PROTECTED.test(room.name) && !args['demo-room-ok'])
      die(`"${room.name}" is a live demo room; seeding posts document notices there. Re-run with --demo-room-ok if you mean it.`);
    await sw.op('update_room', { room_id: room.id, instructions, join_event_listeners: { [agent]: true } });
    say(`room: ${room.name} (${room.id}) existing, instructions and join events updated`);
  } else {
    const name = args['room-name'] ?? content.roomName;
    const live = await sw.op<RoomSummary[]>('list_rooms');
    const clash = live.find((r) => !r.archived && (r.name === name || r.name.endsWith(`: ${name}`)));
    if (clash) die(`a room called "${clash.name}" already exists (${clash.room_id}); pass --room ${clash.room_id} to seed it, or a new --room-name`);
    const created = await sw.op<{ room_id?: string; id?: string }>('create_room', {
      name,
      description: content.description,
      agent_names: [agent],
      ...(bridge
        ? { bridge_id: bridge.id, channel_type: 'channel_public', user_names: [owner] }
        : { internal_only: true }),
      instructions,
      join_event_listeners: [agent],
    });
    const id = created.room_id ?? created.id ?? die(`create_room returned no room id: ${JSON.stringify(created).slice(0, 200)}`);
    room = await sw.op<RoomDetail>('get_room_detail', { room_id: id });
    say(`room: ${room.name} (${room.id}) created, ${room.channel_type ?? 'internal'}`);
  }

  // 4. The owner desk: reuse one, or make a private channel with only the owner and the agent.
  let desk: RoomDetail;
  if (args['owner-desk-room']) {
    desk = await sw.op<RoomDetail>('get_room_detail', { room_id: args['owner-desk-room'] });
    if (bridge && desk.channel_type !== 'channel_private') die(`owner desk ${desk.name} is ${desk.channel_type}, not channel_private`);
    say(`owner desk: ${desk.channel_type ?? 'internal'} ${desk.name} (${desk.id}) reused`);
  } else {
    const created = await sw.op<{ room_id?: string; id?: string }>('create_room', {
      name: `${room.name.replace(/^.*: /, '')}-desk`.slice(0, 70),
      description: 'Private: Context Keeper asks the owner to confirm decisions and rule on clashes here.',
      agent_names: [agent],
      ...(bridge ? { bridge_id: bridge.id, channel_type: 'channel_private', user_names: [owner] } : { internal_only: true }),
      instructions: DESK_INSTRUCTIONS,
      join_event_listeners: [agent],
    });
    desk = await sw.op<RoomDetail>('get_room_detail', { room_id: created.room_id ?? created.id });
    say(`owner desk: ${desk.channel_type ?? 'internal'} ${desk.name} (${desk.id}) created`);
  }

  // 5. Documents, as the agent (so they are its own), skipping any already there (safe to re-run).
  const conn = await sw.op<{ documents?: { id: string; name?: string; description?: string }[]; warning?: string | null }>(
    'connect_to_room',
    { room_id: room.id, include_general_instructions: false },
    room.id,
  );
  if (conn.warning) say(`warning: ${conn.warning}`);
  const have = new Set((conn.documents ?? []).map((d) => d.name));
  const docs: { name: string; id: string; bytes: number; existed: boolean }[] = [];
  for (const d of content.docs) {
    if (have.has(d.name)) {
      docs.push({ name: d.name, id: (conn.documents ?? []).find((x) => x.name === d.name)!.id, bytes: Buffer.byteLength(d.content), existed: true });
      continue;
    }
    const r = await sw.op<{ document_id: string }>('create_room_document', { ...d }, room.id);
    docs.push({ name: d.name, id: r.document_id, bytes: Buffer.byteLength(d.content), existed: false });
  }
  say(`documents: ${docs.length}`);
  for (const d of docs) say(`  ${d.existed ? '=' : '+'} ${d.name} (${d.bytes} bytes)`);

  // 6. Read it all back: what the doctor checks too.
  const after = await sw.op<RoomDetail>('get_room_detail', { room_id: room.id });
  const joinOn = (after.join_event_listeners ?? []).includes(agent);
  const rulesOk = (after.instructions ?? '').trim() === instructions.trim();
  say(`instructions: ${rulesOk ? 'set (room rules + owner line)' : 'MISMATCH on read-back'}`);
  say(`join events: ${joinOn ? 'on' : 'OFF'}`);
  const deskAfter = await sw.op<RoomDetail>('get_room_detail', { room_id: desk.id });
  const deskPeople = deskAfter.connected_user_names ?? [];
  say(`owner desk: ${deskAfter.channel_type ?? 'internal'} (agents: ${deskAfter.agent_names.join(', ')}; people: ${deskPeople.join(', ') || 'none yet'})`);
  say('decision log: left to the agent (it creates its own on start, so only it can edit it)');
  if (!joinOn || !rulesOk) throw new Error('read-back did not match what was set');

  // 7. Remember what was seeded, for the doctor and the agent (state/ is gitignored).
  mkdirSync('state/seed', { recursive: true });
  const record = {
    seeded_at: new Date().toISOString(),
    demo,
    room_id: room.id,
    room_name: after.name,
    bridge: bridge ? { id: bridge.id, type: bridge.type, name: bridge.display_name } : null,
    owner_username: owner,
    owner_desk_room: desk.id,
    agent,
    documents: docs.map(({ name, id }) => ({ name, id })),
  };
  writeFileSync(`state/seed/${room.id}.json`, JSON.stringify(record, null, 2) + '\n');
  writeFileSync('state/seed/last.json', JSON.stringify(record, null, 2) + '\n');
  say(`saved: state/seed/${room.id}.json`);
}

function readUsage(): string {
  return [
    'npm run seed -- [--bridge mattermost|slack|discord|internal] [--demo ledgerly|riverside]',
    '                [--room-name <name> | --room <existing room id>] [--owner-username <name>]',
    '                [--owner-desk-room <id>] [--emit-templates]',
    'Defaults: the server\'s default bridge, demo ledgerly, room name from the demo, the owner\'s linked username.',
  ].join('\n');
}
