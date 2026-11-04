// replay: the live run (PREP eval-harness §1–§3). Fresh ck-eval-<runid>-* rooms on the Mattermost
// bridge, personas posting by `at` (rooms in parallel, burst gaps kept), every trace line and post
// captured to build/eval/<runid>/, then scored by the same pure scorer as --rescore.
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { normalise } from '../src/shared/quote.ts';
import { readTrace, type TraceLine } from '../src/shared/trace.ts';
import type { CaptureMeta, MmPost } from './capture.ts';
import { type Args, ROOT, rescore, writeResult } from './cli.ts';
import { loadCases, ROOM_DIRS, type Case } from './content.ts';
import { ensureEvalAgent, type EvalAgent } from './evalagent.ts';
import { appendFacts, factRows } from './facts.ts';
import { Mattermost, type MmRawPost } from './mattermost.ts';
import { CAST, nameClashes, passwordFor, usernameOf } from './personas.ts';
import { assertNoSecrets, knownSecrets } from './secrets.ts';
import { Gateway, health, readEnvFile, serverEnv, type Room } from './switchapi.ts';
import { SwitchSession } from '../seed/switch.ts';
import { loadYaml } from './yaml.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Mattermost outages ──
// The compose file's Mattermost is amd64-only; under qemu on an Apple Silicon Mac it dies at random
// ("fatal error: fault") every few minutes of load, which would lose a whole run. On a timeout or a
// refused connection the harness restarts that one container (CK_EVAL_MM_CONTAINER, default
// <COMPOSE_PROJECT_NAME from server/.env>-mattermost-1, so a second stack never restarts another
// stack's Mattermost; CK_EVAL_RESTART_MM=0 turns this off), waits for it, checks whether the call
// already landed, and retries once. Every outage is logged and kept in capture.json as an incident.
// It never touches the switch, gateway or postgres containers.
const MM_CONTAINER = process.env.CK_EVAL_MM_CONTAINER || `${serverEnv(ROOT).COMPOSE_PROJECT_NAME || 'ckswitch'}-mattermost-1`;
const incidents: string[] = [];
let recovering: Promise<boolean> | null = null;
const isOutage = (e: unknown) => /timeout|aborted|fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|other side closed/i.test(String((e as Error)?.message ?? e));

async function mmRecover(runDir: string, mmUrl: string, what: string): Promise<boolean> {
  if (process.env.CK_EVAL_RESTART_MM === '0') return false;
  recovering ??= (async () => {
    const mm = new Mattermost(mmUrl);
    if (await mm.ping().catch(() => null)) { incidents.push(`${new Date().toISOString()} ${what}: Mattermost slow but alive; retried`); return true; }
    log(runDir, `Mattermost not answering during ${what}; restarting container ${MM_CONTAINER} (only that container)`);
    const r = spawnSync('docker', ['restart', MM_CONTAINER], { encoding: 'utf8', timeout: 120_000 });
    if (r.status !== 0) { log(runDir, `docker restart ${MM_CONTAINER} failed: ${(r.stderr || '').trim().slice(0, 200)}`); return false; }
    for (let i = 0; i < 60; i++) {
      await sleep(3000);
      if (await mm.ping().catch(() => null)) {
        incidents.push(`${new Date().toISOString()} ${what}: Mattermost down; container ${MM_CONTAINER} restarted, back after ${(i + 1) * 3} s`);
        log(runDir, `Mattermost back after ${(i + 1) * 3} s`);
        await sleep(5000); // let the Switch bridge reconnect
        return true;
      }
    }
    return false;
  })().finally(() => setTimeout(() => { recovering = null; }, 0));
  return recovering;
}

/** Run a Mattermost call; on an outage, recover, then return what `landed()` finds or call again once. */
async function mmRetry<T>(runDir: string, mmUrl: string, what: string, fn: () => Promise<T>, landed?: () => Promise<T | null>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isOutage(e)) throw e;
    log(runDir, `${what}: ${(e as Error).message}`);
    if (!(await mmRecover(runDir, mmUrl, what))) throw e;
    const got = landed ? await landed().catch(() => null) : null;
    if (got) { log(runDir, `${what}: it had landed before the outage`); return got; }
    return await fn();
  }
}
const L_S = 120; // longest model time after a decision is due
const SHORT: Record<string, string> = { 'ledgerly-pilot': 'ledgerly', 'riverside-build-night': 'riverside' };

function log(runDir: string | null, msg: string) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  if (runDir) appendFileSync(join(runDir, 'harness.log'), line + '\n');
}

function git(args: string[]): string | null {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

interface Env { api: string; mmUrl: string; agentName: string; adminEmail: string; adminPassword: string; team: string; model: string | null }

function loadEnv(args: Args): Env {
  const app = { ...readEnvFile(join(ROOT, '.env')), ...readEnvFile(join(ROOT, '.env.local')) };
  const srv = serverEnv(ROOT);
  const pick = (k: string, d?: string) => process.env[k] || app[k] || srv[k] || d || '';
  const env: Env = {
    api: pick('SWITCH_API_URL', 'http://127.0.0.1:18000'),
    mmUrl: pick('MATTERMOST_URL', `http://127.0.0.1:${srv.MATTERMOST_HOST_PORT || '8065'}`),
    agentName: pick('CK_AGENT_NAME', 'context-keeper'),
    adminEmail: srv.GATEWAY_ADMIN_EMAIL || process.env.GATEWAY_ADMIN_EMAIL || '',
    adminPassword: srv.GATEWAY_ADMIN_PASSWORD || process.env.GATEWAY_ADMIN_PASSWORD || '',
    team: srv.MATTERMOST_TEAM_NAME || process.env.MATTERMOST_TEAM_NAME || 'switch',
    model: args.model || pick('CK_MODEL') || null,
  };
  if (!env.adminEmail || !env.adminPassword) throw new Error('no Gateway admin in server/.env (set CK_SERVER_DIR when running from a worktree)');
  return env;
}

/** Windows per room: cases sorted by `at` (not file order); a burst is one window with its real offsets. */
export function plan(cases: Case[]) {
  const rooms = new Map<string, { cases: Case[]; offset_ms: number }[][]>();
  for (const room of [...new Set(cases.map((c) => c.room))].sort()) {
    const sorted = cases.filter((c) => c.room === room).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : 1));
    const ws: { cases: Case[]; offset_ms: number }[][] = [];
    for (const c of sorted) {
      const prev = ws[ws.length - 1];
      if (c.burst && prev && prev[0].cases[0].burst === c.burst) prev.push({ cases: [c], offset_ms: Date.parse(c.at) - Date.parse(prev[0].cases[0].at) });
      else ws.push([{ cases: [c], offset_ms: 0 }]);
    }
    rooms.set(room, ws);
  }
  return rooms;
}

function preflightCases(cases: Case[]) {
  // The test set's own checker needs python3 + PyYAML; a clean clone without them skips it (said
  // out loud) rather than failing, since the cases and sources are also checked by the scorer.
  const py = spawnSync('python3', ['-c', 'import yaml'], { cwd: ROOT, encoding: 'utf8' });
  if (py.status !== 0) console.warn('preflight: testset/check_cases.py skipped (needs python3 with PyYAML)');
  else {
    const r = spawnSync('python3', ['testset/check_cases.py'], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`testset/check_cases.py failed:\n${r.stdout}${r.stderr}`);
  }
  const bodies = new Map<string, string>();
  for (const c of cases) {
    const n = normalise(c.message);
    if (bodies.has(n)) throw new Error(`cases ${bodies.get(n)} and ${c.id} have the same body; matching needs them unique`);
    bodies.set(n, c.id);
  }
}

export async function runLive(args: Args) {
  if (args.robustness) throw new Error('--robustness (R1–R8) is not built yet (eval-harness §10b)');
  if (args.readme && args.setupOnly) throw new Error('--readme needs a scored run');
  for (let i = 1; i <= Math.max(1, args.repeat); i++) await runOnce(args, i);
}

async function runOnce(args: Args, n: number) {
  incidents.length = 0;
  const env = loadEnv(args);
  const { cases: all } = loadCases(ROOT, args.set);
  if (args.only) for (const id of args.only) if (!all.some((c) => c.id === id)) throw new Error(`--only: no case ${id} in the ${args.set} set`);
  const cases = args.only ? all.filter((c) => args.only!.includes(c.id)) : all;

  // ── Preflight ──
  preflightCases(all);
  const switchVersion = await health(env.api);
  if (!switchVersion) throw new Error(`Switch isn't answering at ${env.api}/health`);
  const mm0 = new Mattermost(env.mmUrl);
  const mmVersion = await mm0.ping().catch(() => null);
  if (!mmVersion) throw new Error(`Mattermost isn't answering at ${env.mmUrl} (scripts/server-up.sh --with-mattermost)`);
  const gw = await Gateway.login(env.api, env.adminEmail, env.adminPassword);
  // The agent under test runs as its own identity, never as the demo's context-keeper (eval/evalagent.ts).
  const evalAgent = args.setupOnly || args.attach ? null : await ensureEvalAgent(ROOT, gw, env.api, (m) => console.log(m));
  if (evalAgent) env.agentName = evalAgent.name;
  const bridge = (await gw.bridges()).find((b) => b.bridge_type === 'mattermost' && b.status === 'active');
  if (!bridge) throw new Error('no active Mattermost bridge on the Switch server (scripts/server-up.sh --with-mattermost)');
  const agentNames = (await gw.agents()).map((a) => a.name);
  const usernames = CAST.map(usernameOf);
  const clash = nameClashes(usernames, agentNames);
  if (clash.length) throw new Error(`persona name(s) equal an agent or admin name: ${clash.join(', ')}`);
  if (!args.setupOnly && !agentNames.includes(env.agentName)) throw new Error(`agent ${env.agentName} isn't registered on this server`);
  if (!args.setupOnly && !args.attach) agentCommand(); // fail before any room exists

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  const runId = `r${stamp}-${randomBytes(2).toString('hex')}`;
  const runDir = join(ROOT, 'build/eval', runId);
  mkdirSync(runDir, { recursive: true });
  log(runDir, `run ${runId} (${n}/${args.repeat}): ${cases.length} ${args.set} case(s), Switch ${switchVersion}, Mattermost ${mmVersion}, bridge ${bridge.bridge_id}`);

  // ── Personas (open sign-up, then join the open team) ──
  const srv = serverEnv(ROOT);
  let adminMm: Promise<Mattermost> | null = null;
  const admin = () => (adminMm ??= srv.MATTERMOST_ADMIN_USER && srv.MATTERMOST_ADMIN_PASSWORD
    ? Mattermost.admin(env.mmUrl, srv.MATTERMOST_ADMIN_USER, srv.MATTERMOST_ADMIN_PASSWORD)
    : Promise.reject(new Error('persona password refused and no Mattermost admin in server/.env')));
  const team = await (await Mattermost.persona(env.mmUrl, 'kash', passwordFor(ROOT, 'kash'), 'Kash', admin)).mm.teamByName(env.team);
  const people = new Map<string, { mm: Mattermost; id: string }>();
  for (const name of CAST) {
    const u = usernameOf(name);
    const p = await Mattermost.persona(env.mmUrl, u, passwordFor(ROOT, u), name, admin);
    await p.mm.joinTeam(team.id, p.user.id);
    people.set(u, { mm: p.mm, id: p.user.id });
    log(runDir, `persona ${u} ${p.created ? 'signed up' : p.reset ? 'signed in (password reset by the Mattermost admin: the stored one was lost)' : 'signed in'}`);
  }
  const kash = people.get('kash')!;
  const rooms: Room[] = [];
  let agent: ChildProcess | null = null;

  try {
    if (args.setupOnly) return await smoke(gw, bridge.bridge_id, runId, runDir, people, rooms, team.id);

    // ── Rooms: fresh, public, on the Mattermost bridge, the agent in and listening for joins ──
    const roomPlan = plan(cases);
    const metaRooms: CaptureMeta['rooms'] = {};
    const joiners = new Map<string, string[]>(); // room -> usernames added at replay time (job C trigger)
    const desks = new Map<string, string>(); // room -> the owner desk the seed made for it
    for (const room of roomPlan.keys()) {
      const hist = loadYaml<{ members: string[] }>(join(ROOT, 'demo', ROOM_DIRS[room], 'chat-history.yaml'));
      const members = hist.members.map(usernameOf);
      const late = [...new Set(cases.filter((c) => c.room === room && !members.includes(usernameOf(c.author))).map((c) => usernameOf(c.author)))];
      joiners.set(room, late);
      const r = await gw.createRoom({
        name: `ck-eval-${runId}-${SHORT[room] ?? room}`, description: `Context Keeper eval ${runId} (${room}); invented demo data`,
        bridge_id: bridge.bridge_id, channel_type: 'channel_public', agent_names: [env.agentName], join_event_listeners: [env.agentName], user_names: members,
      });
      rooms.push(r);
      const channel = await mmRetry(runDir, env.mmUrl, `find channel ${r.name}`, () => waitChannel(kash.mm, team.id, r));
      for (const u of members) await mmRetry(runDir, env.mmUrl, `join ${u}`, () => people.get(u)!.mm.joinChannel(channel, people.get(u)!.id)).catch(() => undefined);
      metaRooms[room] = { room_id: r.id, room_name: r.name, channel_id: channel, owner_desk_channel_id: null };
      log(runDir, `room ${r.name} (${r.id}) -> channel ${channel}; members ${members.join(', ')}`);
      const desk = seedRoom(runDir, r.id, ROOM_DIRS[room], evalAgent);
      if (desk) { desks.set(room, desk); rooms.push({ id: desk, name: `${r.name}-desk`, external_channel_id: null, bridge_id: r.bridge_id, archived: false }); }
    }
    // One owner desk for the agent: the first room with a case routed to the owner (all are ledgerly today).
    const deskRoom = [...roomPlan.keys()].find((room) => cases.some((c) => c.room === room && c.expect.routing)) ?? [...roomPlan.keys()][0];

    // ── Agent: started after setup, caps off; or --attach to one already running ──
    const traceFile = args.attach ? process.env.CK_TRACE_FILE || join(ROOT, 'state/trace.jsonl') : join(runDir, 'trace.jsonl');
    const gapS = Number(process.env.CK_BURST_GAP_S || 20);
    agent = args.attach ? null : startAgent(runDir, traceFile, gapS, env.model, {
      ...(evalAgent ? { SWITCH_AGENT_ID: evalAgent.id, SWITCH_AGENT_API_KEY: evalAgent.key } : {}),
      CK_LISTEN_ROOMS: `ck-eval-${runId}-`, CK_POST_ROOMS: `ck-eval-${runId}-`, CK_STATE_DIR: join(runDir, 'agent-state'),
      ...(desks.get(deskRoom) ? { CK_OWNER_DESK_ROOM: desks.get(deskRoom)!, CK_POST_OWNER: '1' } : {}),
      // The owner is the kash persona; Switch's sender id for a Mattermost user is @switch-mattermost-<bridge>-<username>:localhost.
      CK_OWNER_SENDER: `@switch-mattermost-${bridge.bridge_id}-kash:localhost`, CK_OWNER_NAME: 'Kash',
    });
    const traceStart = existsSync(traceFile) ? readFileSync(traceFile, 'utf8').length : 0;
    const readLines = () => (existsSync(traceFile) ? readTrace(readFileSync(traceFile, 'utf8').slice(traceStart)) : []);
    const bot = await mmRetry(runDir, env.mmUrl, 'find the agent bot user', () => waitBot(kash.mm, env.agentName));
    await sleep(10_000); // let the agent connect before t0
    const t0 = Date.now();
    log(runDir, `t0; agent bot user ${bot}`);

    // ── Replay: rooms in parallel, windows in `at` order, bursts at their real offsets ──
    const posted: CaptureMeta['cases'] = [];
    const joins: CaptureMeta['joins'] = [];
    const settle = args.fast ? 5_000 : 15_000;
    await Promise.all([...roomPlan.entries()].map(async ([room, windows]) => {
      const r = metaRooms[room];
      for (const u of joiners.get(room) ?? []) {
        await gw.addUsers(r.room_id, [u]).catch((e) => log(runDir, `addUsers ${u}: ${e.message}`));
        await mmRetry(runDir, env.mmUrl, `join ${u}`, () => people.get(u)!.mm.joinChannel(r.channel_id, people.get(u)!.id)).catch(() => undefined);
        joins.push({ room, username: u, at_ms: Date.now() });
        log(runDir, `${room}: ${u} joined; waiting 20 s`);
        await sleep(20_000);
      }
      for (const w of windows) {
        const start = Date.now();
        const mine: { c: Case; post: MmRawPost }[] = [];
        for (const m of w) {
          const wait = start + m.offset_ms - Date.now();
          if (wait > 0) await sleep(wait);
          const c = m.cases[0];
          const p = people.get(usernameOf(c.author))!;
          const sent = Date.now();
          const post = await mmRetry(runDir, env.mmUrl, `post ${c.id}`, () => p.mm.post(r.channel_id, c.message),
            async () => (await p.mm.allPosts(r.channel_id, sent - 5000)).find((x) => x.user_id === p.id && x.message === c.message) ?? null);
          posted.push({ id: c.id, post_id: post.id, create_at: post.create_at });
          mine.push({ c, post });
          log(runDir, `${c.id} posted by ${usernameOf(c.author)} (${post.id})`);
        }
        const deadline = Date.now() + (gapS + L_S) * 1000;
        while (Date.now() < deadline && !mine.every(({ c }) => readLines().some((l) => covers(l, c)))) await sleep(1000);
        const got = mine.filter(({ c }) => readLines().some((l) => covers(l, c))).length;
        log(runDir, `${w.map((m) => m.cases[0].id).join('+')}: trace covers ${got}/${mine.length}`);
        await sleep(settle);
      }
    }));

    // ── End-of-run sweep, then read every channel once ──
    log(runDir, `sweep: waiting ${gapS + 60} s for late replies`);
    await sleep((gapS + 60) * 1000);
    const lines = readLines();
    writeFileSync(join(runDir, 'trace.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
    for (const room of Object.keys(metaRooms)) {
      const deskName = lines.filter((l) => l.room_id === metaRooms[room].room_id).flatMap((l) => l.posts).find((p) => p.route === 'owner_private')?.room_name;
      if (!deskName) continue;
      const desk = (await mmRetry(runDir, env.mmUrl, 'read owner desks', () => kash.mm.myChannels(team.id))).find((c) => c.type === 'P' && (c.display_name === deskName || c.name === deskName));
      metaRooms[room].owner_desk_channel_id = desk?.id ?? null;
    }
    const posts: MmPost[] = [];
    const channels = new Set(Object.values(metaRooms).flatMap((r) => [r.channel_id, r.owner_desk_channel_id].filter((x): x is string => !!x)));
    for (const ch of [...channels].sort()) {
      for (const p of await mmRetry(runDir, env.mmUrl, `read posts ${ch}`, () => kash.mm.allPosts(ch))) if (!p.delete_at) posts.push({ id: p.id, channel_id: p.channel_id, user_id: p.user_id, root_id: p.root_id ?? '', message: p.message, type: p.type ?? '', create_at: p.create_at });
    }
    stopAgent(agent);
    // The agent's own room documents (its Decision log) as Switch holds them now, for the scorer.
    if (evalAgent) await captureSwitchDocs(runDir, env.api, evalAgent, metaRooms).catch((e) => log(runDir, `switch docs: not captured: ${(e as Error).message}`));

    // ── Capture, score, write ──
    const meta: CaptureMeta = {
      schema: 'ck.capture/1', run_id: runId, set: args.set, mode: args.fast ? 'fast' : 'real-time', model: env.model, burst_gap_s: gapS,
      started_at: new Date(t0).toISOString(), t0_ms: t0, ended_at_ms: Date.now(),
      agent: { name: env.agentName, mm_user_id: bot }, owner_username: 'kash',
      personas: Object.fromEntries(CAST.map((c) => [c, usernameOf(c)])), rooms: metaRooms, joins,
      cases: posted.sort((a, b) => a.create_at - b.create_at), incidents: [...incidents],
      versions: { harness_sha: git(['rev-parse', 'HEAD']), agent_sha: git(['rev-parse', 'HEAD']), switch: switchVersion, mattermost: mmVersion },
    };
    const secrets = knownSecrets(ROOT);
    const metaJson = JSON.stringify(meta, null, 2) + '\n';
    const postsJson = JSON.stringify({ posts }, null, 2) + '\n';
    assertNoSecrets(metaJson + postsJson + lines.map((l) => JSON.stringify(l)).join('\n'), secrets, `build/eval/${runId}`);
    writeFileSync(join(runDir, 'capture.json'), metaJson);
    writeFileSync(join(runDir, 'mattermost.json'), postsJson);
    const result = rescore(runDir);
    const out = resultPath(env.model ?? 'unknown-model', args.set);
    const md = writeResult(result, out);
    log(runDir, `wrote ${relative(ROOT, out)}`);
    const dirty = git(['status', '--porcelain', '--untracked-files=no', '--', 'src', 'eval', 'prompts', 'seed', 'testset', 'demo']);
    const sha = git(['rev-parse', 'HEAD']);
    appendFacts(ROOT, factRows(result, `npm run eval -- ${process.argv.slice(2).join(' ')}`.trim(), sha && dirty ? `${sha.slice(0, 7)}+changes` : sha, relative(ROOT, out)));
    log(runDir, 'appended facts.md');
    console.log('\n' + md);
    if (args.readme) swapReadme(md);
  } finally {
    stopAgent(agent); // also on a failed run: never leave the agent under test running
    if (!args.keep) for (const r of rooms) await gw.archive(r.id).then(() => log(runDir, `archived ${r.name}`)).catch((e) => log(runDir, `archive ${r.name}: ${e.message}`));
  }
}

const covers = (l: TraceLine, c: Case) => l.inputs.some((i) => i.sender.toLowerCase() === usernameOf(c.author) && normalise(i.body).startsWith(normalise(c.message)));

async function waitChannel(mm: Mattermost, teamId: string, r: Room): Promise<string> {
  for (let i = 0; i < 30; i++) {
    if (r.external_channel_id) return r.external_channel_id;
    const ch = await mm.channelByName(teamId, r.name);
    if (ch) return ch.id;
    const hit = (await mm.searchChannels(teamId, r.name)).find((c) => c.display_name === r.name || c.name === r.name);
    if (hit) return hit.id;
    await sleep(1000);
  }
  throw new Error(`no Mattermost channel appeared for room ${r.name}`);
}

async function waitBot(mm: Mattermost, agentName: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const u = await mm.userByUsername(agentName);
    if (u) return u.id;
    await sleep(1000);
  }
  throw new Error(`no Mattermost bot user named ${agentName}`);
}

/** After the agent has stopped: read each room's documents back from Switch as the agent under test
 *  (list_references + load_internal_documents, the agent's own route) and save the ones the agent
 *  wrote during the run (its Decision log) to <run dir>/switch-docs/<room>/decision-log.md, so the
 *  scorer can check a citation of it against what the room held. index.json lists every document. */
async function captureSwitchDocs(runDir: string, api: string, agent: EvalAgent, rooms: CaptureMeta['rooms']) {
  const sw = await SwitchSession.open({ endpoint: api.replace(/\/$/, ''), agentId: agent.id, token: agent.key });
  const secrets = knownSecrets(ROOT);
  try {
    for (const [room, r] of Object.entries(rooms)) {
      await sw.op('connect_to_room', { room_id: r.room_id, include_general_instructions: false }, r.room_id);
      const refs = await sw.op<{ documents?: { id: string; name: string; created_by_agent_id?: string }[] }>('list_references', {}, r.room_id);
      const docs = refs.documents ?? [];
      const logs = docs.filter((d) => d.created_by_agent_id === agent.id && /^Decision log( \(v\d+\))?$/.test(d.name));
      const texts = logs.length ? await sw.op<{ id: string; content: string }[]>('load_internal_documents', { ids: logs.map((d) => d.id) }, r.room_id) : [];
      const dir = join(runDir, 'switch-docs', room);
      mkdirSync(dir, { recursive: true });
      const index = JSON.stringify({ room_id: r.room_id, documents: docs.map((d) => ({ name: d.name, id: d.id, created_by_agent: d.created_by_agent_id === agent.id })) }, null, 2) + '\n';
      assertNoSecrets(index, secrets, `switch-docs/${room}/index.json`);
      writeFileSync(join(dir, 'index.json'), index);
      const mine = texts.find((t) => t.id === logs[0]?.id);
      if (mine) {
        assertNoSecrets(mine.content, secrets, `switch-docs/${room}/decision-log.md`);
        writeFileSync(join(dir, 'decision-log.md'), mine.content);
      }
      log(runDir, `switch docs ${room}: ${docs.length} documents in Switch${mine ? `; Decision log saved (${mine.content.length} chars)` : '; no Decision log'}`);
    }
  } finally { sw.close(); }
}

/** Seed a fresh room with `npm run seed` (the same command as the README) as the agent under test.
 *  Returns the owner desk room it made. */
function seedRoom(runDir: string, roomId: string, demo: string, agent: EvalAgent | null): string | null {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  if (!pkg.scripts?.seed) { log(runDir, 'seed: no `npm run seed` yet (seed lane), room left unseeded'); return null; }
  const env = { ...process.env, ...(agent ? { SWITCH_AGENT_ID: agent.id, SWITCH_AGENT_API_KEY: agent.key } : {}) };
  const r = spawnSync('npm', ['run', '-s', 'seed', '--', '--bridge', 'mattermost', '--demo', demo, '--room', roomId, '--owner-username', 'kash'], { cwd: ROOT, encoding: 'utf8', env });
  appendFileSync(join(runDir, 'harness.log'), r.stdout + r.stderr);
  if (r.status !== 0) throw new Error(`seed failed for ${roomId} (see harness.log)`);
  const rec = join(ROOT, 'state/seed', `${roomId}.json`);
  const desk = existsSync(rec) ? (JSON.parse(readFileSync(rec, 'utf8')) as { owner_desk_room?: string }).owner_desk_room ?? null : null;
  log(runDir, `seeded ${roomId} (${demo}); owner desk ${desk ?? 'none'}`);
  return desk;
}

function agentCommand(): string {
  const cmd = process.env.CK_AGENT_CMD || 'npx tsx src/agent/main.ts';
  const entry = cmd.split(' ').find((p) => p.endsWith('.ts'));
  if (entry && !existsSync(join(ROOT, entry))) throw new Error(`agent entry ${entry} doesn't exist yet (core lane); set CK_AGENT_CMD or use --attach`);
  return cmd;
}

function startAgent(runDir: string, traceFile: string, gapS: number, model: string | null, extra: Record<string, string>): ChildProcess {
  const cmd = agentCommand();
  const out = join(runDir, 'agent.log');
  // The agent's optional parts (src/agent/features.ts: job E, the audio brief, the talk link) are on by
  // default for the demo; a scored run keeps them off unless this eval's own env sets them.
  const features = Object.fromEntries(['CK_JOB_E', 'CK_AUDIO_BRIEF', 'CK_TALK_LINK'].map((k) => [k, process.env[k] || '0']));
  const child = spawn(cmd, { cwd: ROOT, shell: true, detached: true, env: { ...process.env, ...features, ...extra, CK_TRACE_FILE: traceFile, CK_CAPS: 'off', CK_BURST_GAP_S: String(gapS), ...(model ? { CK_MODEL: model } : {}) } });
  child.stdout?.on('data', (d) => appendFileSync(out, d));
  child.stderr?.on('data', (d) => appendFileSync(out, d));
  return child;
}

/** The agent runs through a shell and npx, so signal its whole process group. */
function stopAgent(child: ChildProcess | null) {
  if (!child?.pid || child.exitCode !== null) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
}

function resultPath(model: string, set: string): string {
  const day = new Date().toISOString().slice(0, 10);
  const base = `testset/results/${day}-${set === 'main' ? '' : `${set}-`}${model}`;
  for (let i = 1; ; i++) {
    const p = join(ROOT, `${base}${i === 1 ? '' : `-${i}`}.json`);
    if (!existsSync(p)) return p;
  }
}

function swapReadme(md: string) {
  const f = join(ROOT, 'README.md');
  const text = readFileSync(f, 'utf8');
  const re = /<!-- eval:start -->[\s\S]*?<!-- eval:end -->/;
  if (!re.test(text)) throw new Error('README.md has no <!-- eval:start --> ... <!-- eval:end --> block');
  writeFileSync(f, text.replace(re, `<!-- eval:start -->\n${md}<!-- eval:end -->`));
}

/** --setup-only: prove the posting route without the agent. A fresh ck-eval room with no agents,
 *  one persona posts, the post is read back, the room is archived. */
async function smoke(gw: Gateway, bridgeId: string, runId: string, runDir: string, people: Map<string, { mm: Mattermost; id: string }>, rooms: Room[], teamId: string) {
  const r = await gw.createRoom({ name: `ck-eval-${runId}-smoke`, description: 'Context Keeper eval: posting-route smoke test (no agents)', bridge_id: bridgeId, channel_type: 'channel_public', user_names: ['rowan'] });
  rooms.push(r);
  const ch = await waitChannel(people.get('kash')!.mm, teamId, r);
  const rowan = people.get('rowan')!;
  await rowan.mm.joinChannel(ch, rowan.id).catch(() => undefined);
  const text = `ck-eval smoke ${runId}: posted by persona rowan through the Mattermost REST API`;
  const post = await rowan.mm.post(ch, text);
  await sleep(3000);
  const back = (await rowan.mm.allPosts(ch)).find((p) => p.id === post.id);
  const evidence = { run_id: runId, switch_room: { id: r.id, name: r.name, bridge_id: r.bridge_id }, mattermost_channel: ch, post: { id: post.id, user_id: post.user_id, create_at: post.create_at }, read_back: !!back && back.message === text };
  const json = JSON.stringify(evidence, null, 2);
  assertNoSecrets(json, knownSecrets(ROOT), `build/eval/${runId}/smoke.json`);
  writeFileSync(join(runDir, 'smoke.json'), json + '\n');
  log(runDir, `smoke: ${json}`);
  if (!evidence.read_back) throw new Error('smoke: the persona post was not read back');
}
