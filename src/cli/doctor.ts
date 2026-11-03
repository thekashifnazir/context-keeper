// ck doctor: is this machine ready to run Context Keeper? One line per check: ok, WARN, SKIP or FAIL.
// Exits 1 if anything FAILs. Rooms not seeded yet print SKIP, not FAIL. Read-only: it never joins a
// room (that would take it off the running agent's connection) and never posts. --offline skips
// every network check (cold start).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { credsFromEnv, loadDotenv, type Bridge, type SwitchSession as Session, SwitchSession } from '../../seed/switch.ts';

type Status = 'ok' | 'WARN' | 'SKIP' | 'FAIL';
const results: Status[] = [];
function line(status: Status, check: string, detail: string) {
  results.push(status);
  console.log(`${status.padEnd(4)}  ${check.padEnd(13)} ${detail}`);
}

interface RoomDetail {
  id: string;
  name: string;
  channel_type: string | null;
  instructions: string | null;
  bridge_id: string | null;
  agent_names: string[];
  agent_statuses?: Record<string, string>;
  connected_user_names?: string[];
  join_event_listeners?: string[];
  archived?: boolean;
}
interface SeedRecord {
  room_id: string;
  room_name: string;
  owner_username: string;
  owner_desk_room: string;
  bridge: { id: string; type: string } | null;
  documents: { name: string }[];
}

const readJson = <T,>(f: string): T | null => {
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as T;
  } catch {
    return null;
  }
};

async function timed<T>(ms: number, p: Promise<T>): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`timed out after ${ms / 1000} s`)), ms)));
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t);
  }
}

async function reachable(url: string): Promise<number | null> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).status;
  } catch {
    return null;
  }
}

export async function run(argv: string[]): Promise<number> {
  const offline = argv.includes('--offline');
  const t0 = Date.now();

  // Before .env is loaded: the key must live in .env, never in the shell (house rule).
  const exported = 'ANTHROPIC_API_KEY' in process.env;
  line(exported ? 'FAIL' : 'ok', 'anthropic env', exported ? 'ANTHROPIC_API_KEY is exported in this shell; unset it, the app reads .env' : 'ANTHROPIC_API_KEY not exported');
  loadDotenv();
  line(process.env.ANTHROPIC_API_KEY ? 'ok' : 'FAIL', 'anthropic key', process.env.ANTHROPIC_API_KEY ? 'present in .env' : 'missing from .env');

  const creds = credsFromEnv();
  line(creds ? 'ok' : 'FAIL', 'switch key', creds ? 'SWITCH_API_URL, SWITCH_AGENT_ID and SWITCH_AGENT_API_KEY present' : 'missing (run scripts/server-up.sh)');

  let email = '';
  try {
    email = execFileSync('git', ['config', 'user.email'], { encoding: 'utf8' }).trim();
  } catch {}
  const noreply = /@users\.noreply\.github\.com$/.test(email);
  line(noreply ? 'ok' : 'FAIL', 'git email', noreply ? 'noreply address' : `git user.email is ${email ? 'not a noreply address' : 'unset'}`);

  line('SKIP', 'model params', 'max_tokens and thinking: checked once the agent loop exists (core lane)');
  line('SKIP', 'budget', 'no spend check wired yet');

  if (offline || !creds) {
    for (const c of ['health', 'ports', 'stream', 'bridge', 'rooms', 'join events', 'owner desk'])
      line('SKIP', c, offline ? '--offline' : 'no Switch credentials');
    return finish(t0);
  }

  const health = await reachable(`${creds.endpoint}/health`);
  line(health === 200 ? 'ok' : 'FAIL', 'health', health === 200 ? `${creds.endpoint}/health` : `${creds.endpoint}/health ${health ?? 'unreachable'} (start it: scripts/server-up.sh)`);

  const gw = process.env.SWITCH_GATEWAY_URL;
  const gwStatus = gw ? await reachable(gw) : null;
  const usesForbidden = [creds.endpoint, gw].some((u) => u && /:8086(\/|$)/.test(u));
  line(
    usesForbidden ? 'FAIL' : gw && gwStatus === null ? 'WARN' : 'ok',
    'ports',
    usesForbidden ? 'config points at port 8086 (not ours)' : `api ${new URL(creds.endpoint).port || 80} up${gw ? `, gateway ${new URL(gw).port} ${gwStatus === null ? 'not answering' : 'up'}` : ''}`,
  );
  if (health !== 200) {
    for (const c of ['stream', 'bridge', 'rooms', 'join events', 'owner desk']) line('SKIP', c, 'server not healthy');
    return finish(t0);
  }

  let sw: Session | undefined;
  try {
    sw = await timed(12_000, SwitchSession.open(creds, 10_000));
    line('ok', 'stream', 'opened a fresh connection (closed again at the end)');
  } catch (e) {
    line('FAIL', 'stream', (e as Error).message);
    for (const c of ['bridge', 'rooms', 'join events', 'owner desk']) line('SKIP', c, 'no stream connection');
    return finish(t0);
  }
  try {
    await checks(sw);
  } catch (e) {
    line('FAIL', 'switch', (e as Error).message);
  } finally {
    sw.close();
  }
  return finish(t0);
}

async function checks(sw: Session) {
  const me = await timed(8000, sw.op<{ you: { name: string } }>('get_my_context'));
  const agent = me.you.name;

  const bridges = await timed(8000, sw.op<Bridge[]>('list_bridges'));
  const active = bridges.filter((b) => b.status === 'active');
  line(active.length ? 'ok' : 'FAIL', 'bridge', active.length ? active.map((b) => `${b.type} "${b.display_name}"${b.is_default ? ' (default)' : ''}`).join(', ') : 'no active messaging-app bridge');

  // Rooms the seed command recorded (state/seed/*.json). None yet: SKIP.
  const dir = 'state/seed';
  const records = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json') && f !== 'last.json')
        .map((f) => readJson<SeedRecord>(`${dir}/${f}`))
        .filter((r): r is SeedRecord => !!r)
    : [];
  const live = await timed(8000, sw.op<{ room_id: string }[]>('list_rooms'));
  if (!records.length) {
    line('SKIP', 'rooms', `${live.length} room(s) on the server; none seeded yet (npm run seed)`);
    line('SKIP', 'join events', 'no seeded room');
  } else {
    let joinOn = 0;
    for (const r of records) {
      let d: RoomDetail;
      try {
        d = await timed(8000, sw.op<RoomDetail>('get_room_detail', { room_id: r.room_id }));
      } catch (e) {
        line('FAIL', 'rooms', `${r.room_name}: ${(e as Error).message.slice(0, 120)}`);
        continue;
      }
      if (d.archived) {
        line('SKIP', 'rooms', `${d.name}: archived`);
        continue;
      }
      const problems = [
        !d.agent_names.includes(agent) && `${agent} not a member`,
        !(d.instructions ?? '').includes('In this room, the agent must always') && 'room rules missing from instructions',
        r.bridge && !active.some((b) => b.id === d.bridge_id) && 'bridge not active',
      ].filter(Boolean);
      const status = d.agent_statuses?.[agent] ?? 'unknown';
      line(problems.length ? 'FAIL' : 'ok', 'rooms', `${d.name}: ${problems.length ? problems.join('; ') : `rules set, ${r.documents.length} docs seeded, agent ${status}`}`);
      if ((d.join_event_listeners ?? []).includes(agent)) joinOn++;
      else line('FAIL', 'join events', `${d.name}: off for ${agent} (npm run seed -- --room ${d.id})`);
    }
    if (joinOn) line('ok', 'join events', `on in ${joinOn} seeded room(s)`);
  }

  // The owner desk: from state/owner.json (learned live), CK_OWNER_DESK_ROOM, or the seed records.
  const desks = new Set<string>();
  const owner = readJson<{ owner_desk_room?: string }>('state/owner.json');
  if (owner?.owner_desk_room) desks.add(owner.owner_desk_room);
  if (process.env.CK_OWNER_DESK_ROOM) desks.add(process.env.CK_OWNER_DESK_ROOM);
  for (const r of records) desks.add(r.owner_desk_room);
  if (!desks.size) line('SKIP', 'owner desk', 'none yet (npm run seed makes one)');
  for (const id of desks) {
    try {
      const d = await timed(8000, sw.op<RoomDetail>('get_room_detail', { room_id: id }));
      const people = d.connected_user_names ?? [];
      const ok = (d.channel_type === 'channel_private' || d.channel_type === null) && d.agent_names.includes(agent) && people.length <= 1;
      line(ok ? 'ok' : 'FAIL', 'owner desk', `${d.name}: ${d.channel_type ?? 'internal'}, people: ${people.join(', ') || 'none'}${ok ? '' : ' (must be private, with only the owner and the agent)'}`);
    } catch (e) {
      line('FAIL', 'owner desk', `${id}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
}

function finish(t0: number): number {
  const fails = results.filter((s) => s === 'FAIL').length;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(fails ? `doctor: ${fails} FAIL (${secs} s)` : `doctor: OK (${secs} s)`);
  return fails ? 1 : 0;
}
