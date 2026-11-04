// robustness-live: `npm run eval -- --robustness [all|R2,R4,…]` (PREP eval-harness §10b). Scripted live
// runs against the real agent (src/agent/main.ts, as the scored run starts it), each in a fresh
// ck-eval-<runid>-<tag>-ledgerly room seeded like the scored run's, with its own owner desk:
//   r2   R2 restart mid-burst: Rowan joins, posts B1; the agent is SIGKILLed once T01 sits in its saved
//        burst queue (agent-buffer.json) and restarted at once; T02 and T03 arrive on schedule
//   ch   R4 (CK_FAULT=model_500 then T05), R8 (stop, T08, start), R6 (T12's clash, restart, the
//        owner rules in the desk), R5 (the owner says "wrong" in T05's thread); R3 over all of it
//   cap  R7, adapted to the current design: the per-person demo limit, then the daily spend cap
// R1 is the offline unit test (test/offline/jobA.test.ts "R1 quote gate"), as the plan says.
// Nothing here changes the agent: faults, limits and caps are the agent's own env switches. Rowan is
// marked briefed in the agent's state file before the ch and cap rooms start (he had his catch-up),
// so a brief's model call can't take R4's injected fault. Results: testset/results/<day>-robustness-
// <model>.json/.md, rows in facts.md; the raw capture stays in build/eval/<runid>/<tag>/.
import { spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LIMIT_LINE, PAUSED_LINE } from '../src/agent/demo.ts';
import { normalise } from '../src/shared/quote.ts';
import { readTrace, type TraceLine } from '../src/shared/trace.ts';
import { type Args, ROOT } from './cli.ts';
import { loadCases, type Case } from './content.ts';
import { appendFacts } from './facts.ts';
import type { MmRawPost } from './mattermost.ts';
import { incidents, log, L_S, mmRetry, prepare, seedRoom, sleep, startAgent, stopAgent, waitBot, waitChannel, type World } from './replay.ts';
import {
  checkR2, checkR3, checkR4, checkR5, checkR6, checkR7a, checkR7b, checkR8, robustnessFactRows, robustnessMarkdown, traceCost,
  type RCapture, type RobustnessReport, type RResult,
} from './robustness.ts';
import { assertNoSecrets, knownSecrets } from './secrets.ts';
import type { Room } from './switchapi.ts';

export const ALL = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'] as const;

/** `--robustness` alone (or "all") runs every check; else a comma list like "R2,R7". */
export function whichChecks(v: string | null): string[] {
  if (!v || v === 'all') return [...ALL];
  const ids = v.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  for (const id of ids) if (!(ALL as readonly string[]).includes(id)) throw new Error(`--robustness: no check ${id} (R1–R8)`);
  return ids;
}

const GAP_S = Number(process.env.CK_BURST_GAP_S || 20);
const DECIDE_MS = (GAP_S + L_S) * 1000;
const git = (a: string[]) => { const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };

async function until(what: string, ms: number, pred: () => boolean | Promise<boolean>, every = 1000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await pred()) return true; await sleep(every); }
  console.log(`  (gave up waiting for ${what} after ${Math.round(ms / 1000)} s)`);
  return false;
}

/** One room, its desk, and the agent under test started and stopped in it. */
class Scenario {
  readonly dir: string;
  readonly stateDir: string;
  readonly traceFile: string;
  readonly logFile: string;
  room!: Room;
  channel!: string;
  desk: string | null = null; // Switch room id of the owner desk the seed made
  deskChannel: string | null = null;
  agent: ChildProcess | null = null;
  bot = '';
  cases: RCapture['cases'] = {};
  marks: Record<string, number> = {};
  metered = { usd: 0, calls: 0 };
  private logAt = 0;
  private env: Record<string, string> = {};

  constructor(readonly w: World, readonly tag: string, readonly rooms: Room[]) {
    this.dir = join(w.runDir, tag);
    this.stateDir = join(this.dir, 'agent-state');
    this.traceFile = join(this.dir, 'trace.jsonl');
    this.logFile = join(this.dir, 'agent.log');
    mkdirSync(this.stateDir, { recursive: true });
  }
  log(m: string) { log(this.w.runDir, `[${this.tag}] ${m}`); }
  get prefix() { return `ck-eval-${this.w.runId}-${this.tag}-`; }
  sender(u: string) { return `@switch-mattermost-${this.w.bridge.bridge_id}-${u}:localhost`; }

  /** A fresh seeded ledgerly room; `members` are in it from the start. */
  async setup(members: string[]) {
    const { gw, env, kash, team, people } = this.w;
    const r = await gw.createRoom({
      name: `${this.prefix}ledgerly`, description: `Context Keeper robustness ${this.w.runId} (${this.tag}); invented demo data`,
      bridge_id: this.w.bridge.bridge_id, channel_type: 'channel_public', agent_names: [env.agentName], join_event_listeners: [env.agentName], user_names: members,
    });
    this.room = r;
    this.rooms.push(r);
    this.channel = await mmRetry(this.w.runDir, env.mmUrl, `find channel ${r.name}`, () => waitChannel(kash.mm, team.id, r));
    for (const u of members) await people.get(u)!.mm.joinChannel(this.channel, people.get(u)!.id).catch(() => undefined);
    this.desk = seedRoom(this.w.runDir, r.id, 'ledgerly-pilot', this.w.evalAgent);
    if (this.desk) this.rooms.push({ id: this.desk, name: `${r.name}-desk`, external_channel_id: null, bridge_id: r.bridge_id, archived: false });
    this.log(`room ${r.name} (${r.id}) -> channel ${this.channel}; members ${members.join(', ')}; desk ${this.desk ?? 'none'}`);
  }

  /** The person already had their catch-up brief here (the agent's own state file format). */
  markBriefed(users: string[]) {
    const f = join(this.stateDir, 'agent-state.json');
    const s = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { rooms: {} };
    const r = (s.rooms[this.room.id] ??= { processed: [], posted: {}, ideas: [] });
    r.briefed = [...new Set([...(r.briefed ?? []), ...users.map((u) => this.sender(u))])];
    writeFileSync(f, JSON.stringify(s, null, 1));
  }

  async start(extra: Record<string, string> = {}) {
    const { evalAgent, env } = this.w;
    this.env = extra;
    this.logAt = existsSync(this.logFile) ? readFileSync(this.logFile, 'utf8').length : 0;
    this.agent = startAgent(this.dir, this.traceFile, GAP_S, env.model, {
      ...(evalAgent ? { SWITCH_AGENT_ID: evalAgent.id, SWITCH_AGENT_API_KEY: evalAgent.key } : {}),
      CK_LISTEN_ROOMS: this.prefix, CK_POST_ROOMS: this.prefix, CK_STATE_DIR: this.stateDir,
      ...(this.desk ? { CK_OWNER_DESK_ROOM: this.desk, CK_POST_OWNER: '1' } : {}),
      CK_OWNER_SENDER: this.sender('kash'), CK_OWNER_NAME: 'Kash',
      // The meter counts every model call into <state>/spend.json for the cost line; a cap this high is never reached.
      CK_DAILY_SPEND_CAP_USD: '50',
      ...extra,
    }, this.logFile);
    const t = Date.now();
    this.log(`agent started (pid ${this.agent.pid})${Object.keys(extra).length ? ` with ${Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}`);
    if (!this.bot) this.bot = await waitBot(this.w.kash.mm, env.agentName);
    const ok = await until('the agent to join its room', 90_000, () => this.agentLog(true).includes(`listening in ${this.room.name} (`), 500);
    if (!ok) throw new Error(`[${this.tag}] the agent never joined ${this.room.name} (see ${relative(ROOT, this.logFile)})`);
    this.log(`agent connected after ${((Date.now() - t) / 1000).toFixed(1)} s`);
    return t;
  }

  async stop(signal: NodeJS.Signals = 'SIGTERM') {
    const a = this.agent;
    if (!a) return;
    stopAgent(a, signal);
    await until('the agent to exit', 15_000, () => a.exitCode !== null || a.signalCode !== null, 200);
    await sleep(500);
    this.agent = null;
    this.noteSpend();
    this.log(`agent stopped (${signal})`);
  }

  /** Moves <state>/spend.json's total into this scenario's metered spend (called with the agent
   *  stopped), so each start counts from zero: R7b needs a fresh day under its tiny cap. */
  noteSpend() {
    const f = join(this.stateDir, 'spend.json');
    if (!existsSync(f)) return;
    const s = JSON.parse(readFileSync(f, 'utf8')) as { usd?: number; calls?: number };
    this.metered.usd += s.usd ?? 0;
    this.metered.calls += s.calls ?? 0;
    rmSync(f);
  }

  agentLog(sinceStart = false) {
    const t = existsSync(this.logFile) ? readFileSync(this.logFile, 'utf8') : '';
    return sinceStart ? t.slice(this.logAt) : t;
  }
  trace(): TraceLine[] { return existsSync(this.traceFile) ? readTrace(readFileSync(this.traceFile, 'utf8')) : []; }

  async post(user: string, label: string, body: string, rootId = '', channel = this.channel): Promise<MmRawPost> {
    const p = this.w.people.get(user)!;
    const sent = Date.now();
    const post = await mmRetry(this.w.runDir, this.w.env.mmUrl, `post ${label}`, () => p.mm.post(channel, body, rootId),
      async () => (await p.mm.allPosts(channel, sent - 5000)).find((x) => x.user_id === p.id && x.message === body) ?? null);
    this.cases[label] = { post_id: post.id, create_at: post.create_at, body, channel };
    this.log(`${label} posted by ${user}${rootId ? ' (in a thread)' : ''}: "${body.slice(0, 60)}"`);
    return post;
  }

  covered(label: string, pred: (l: TraceLine) => boolean = () => true) {
    const n = normalise(this.cases[label].body);
    return this.trace().some((l) => l.kind !== 'brief' && l.inputs.some((i) => normalise(i.body).startsWith(n)) && pred(l));
  }

  async findDesk(): Promise<string | null> {
    if (this.deskChannel) return this.deskChannel;
    const names = new Set([...this.trace().flatMap((l) => l.posts).filter((p) => p.route === 'owner_private').map((p) => p.room_name), `${this.room.name}-desk`]);
    const mine = await mmRetry(this.w.runDir, this.w.env.mmUrl, 'read owner desks', () => this.w.kash.mm.myChannels(this.w.team.id));
    this.deskChannel = mine.find((c) => c.type === 'P' && (names.has(c.display_name) || names.has(c.name)))?.id ?? null;
    return this.deskChannel;
  }

  async posts(): Promise<MmRawPost[]> {
    const out: MmRawPost[] = [];
    for (const ch of [this.channel, await this.findDesk()].filter((x): x is string => !!x)) out.push(...await mmRetry(this.w.runDir, this.w.env.mmUrl, `read posts ${ch}`, () => this.w.kash.mm.allPosts(ch)));
    return out;
  }

  async capture(): Promise<RCapture> {
    const posts = await this.posts();
    const trace = this.trace();
    const cap: RCapture = { bot: this.bot, agentName: this.w.env.agentName, channel: this.channel, desk: this.deskChannel, trace, posts, cases: this.cases, marks: this.marks, agentLog: this.agentLog() };
    const json = JSON.stringify({ room: { id: this.room.id, name: this.room.name }, ...cap, agentLog: undefined }, null, 2) + '\n';
    assertNoSecrets(json, knownSecrets(ROOT), `build/eval/${this.w.runId}/${this.tag}/capture.json`);
    writeFileSync(join(this.dir, 'capture.json'), json);
    return cap;
  }
}

const byId = (cases: Case[], id: string) => { const c = cases.find((x) => x.id === id); if (!c) throw new Error(`no case ${id}`); return c; };

// ── R2 ─────────────────────────────────────────────────────────────────────────────────────────────
async function scenarioR2(s: Scenario, cases: Case[]): Promise<RResult[]> {
  const b1 = cases.filter((c) => c.burst === 'B1').sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  await s.setup(['kash', 'priya', 'sam']); // as the scored run: Rowan is a late joiner (the returner brief)
  await s.start();
  await s.w.gw.addUsers(s.room.id, ['rowan']);
  await s.w.people.get('rowan')!.mm.joinChannel(s.channel, s.w.people.get('rowan')!.id).catch(() => undefined);
  s.log('rowan joined; waiting 20 s');
  await sleep(20_000);
  const t0 = Date.now();
  const first = b1[0];
  await s.post('rowan', first.id, first.message);
  const buf = join(s.stateDir, 'agent-buffer.json');
  const queued = await until(`${first.id} in agent-buffer.json`, 30_000, () => existsSync(buf) && readFileSync(buf, 'utf8').includes(first.message.slice(0, 40)), 100);
  if (!queued) throw new Error(`${first.id} never reached the saved burst queue`);
  s.marks.queued_at = Date.now();
  s.marks.killed_at = Date.now();
  await s.stop('SIGKILL');
  // The rest of B1 arrives on schedule while the agent restarts.
  const rest = (async () => {
    for (const c of b1.slice(1)) {
      const wait = t0 + (Date.parse(c.at) - Date.parse(first.at)) - Date.now();
      if (wait > 0) await sleep(wait);
      await s.post('rowan', c.id, c.message);
    }
  })();
  s.marks.started_at = Date.now();
  await s.start();
  s.marks.connected_at = Date.now();
  await rest;
  await until('a decision covering each of B1', DECIDE_MS + 90_000, () => b1.every((c) => s.covered(c.id)));
  await sleep(30_000); // anything late (a second reply, a brief)
  await s.stop();
  const cap = await s.capture();
  return [checkR2(cap, b1.map((c) => c.id))];
}

// ── R3, R4, R5, R6, R8 ─────────────────────────────────────────────────────────────────────────────
async function scenarioChain(s: Scenario, cases: Case[], want: Set<string>): Promise<RResult[]> {
  const T05 = byId(cases, 'T05'), T08 = byId(cases, 'T08'), T12 = byId(cases, 'T12');
  const missesFile = join(ROOT, 'testset/misses.yaml');
  const misses = () => (existsSync(missesFile) ? (readFileSync(missesFile, 'utf8').match(/^\s*-\s/gm) ?? []).length : 0);
  const missesBefore = misses();
  await s.setup(['kash', 'priya', 'sam', 'rowan']);
  s.markBriefed(['rowan']);

  // R4: the first model call fails with a 500.
  await s.start({ CK_FAULT: 'model_500', CK_FAULT_TIMES: '1' });
  await sleep(5000);
  await s.post('rowan', 'T05', T05.message);
  await until('T05 retried and replied', DECIDE_MS + 60_000 + L_S * 1000, () => s.covered('T05', (l) => l.kind === 'reply'));
  await sleep(10_000);

  // R8: stopped, T08 posted, started again.
  s.marks.stopped_at = Date.now();
  await s.stop('SIGTERM');
  await sleep(3000);
  await s.post('rowan', 'T08', T08.message);
  await sleep(10_000);
  s.marks.started_at = Date.now();
  await s.start();
  await until('T08 decided after the restart', DECIDE_MS + 30_000, () => s.covered('T08'));
  await sleep(10_000);

  // R6: T12's clash goes to the desk; restart before the owner answers; the owner answers.
  await s.post('rowan', 'T12', T12.message);
  await until('T12 decided', DECIDE_MS + 30_000, () => s.covered('T12'));
  await sleep(10_000);
  await s.stop('SIGTERM');
  s.marks.restarted_at = Date.now();
  await s.start();
  await sleep(5000);
  const desk = await s.findDesk();
  const note = desk ? (await s.posts()).find((p) => p.channel_id === desk && p.user_id === s.bot && /Clash to rule on/.test(p.message)) : undefined;
  if (note) {
    const n = note.message.match(/#(\d+)\b/)?.[1] ?? '1';
    s.marks.answer_at = Date.now();
    await s.post('kash', 'ANSWER', `#${n} plan stands`, note.id, desk!);
    await until('the ruling in T12\'s thread', 120_000, async () => (await s.posts()).some((p) => p.user_id === s.bot && p.root_id === s.cases.T12.post_id && p.create_at > s.marks.answer_at), 3000);
    await sleep(5000);
  } else s.log('R6: no clash note found in the owner desk; the owner has nothing to answer');

  // R5: the owner says the reply to T05 was wrong, in its thread.
  if (want.has('R5')) {
    s.marks.wrong_at = Date.now();
    await s.post('kash', 'WRONG', 'wrong', s.cases.T05.post_id);
    await until('the agent to read "wrong"', DECIDE_MS, () => s.covered('WRONG'));
    await sleep(30_000);
  }
  await s.stop();
  const cap = await s.capture();
  const out: RResult[] = [];
  if (want.has('R3')) out.push(checkR3(cap));
  if (want.has('R4')) out.push(checkR4(cap, 'T05', String(T05.expect.verdict)));
  if (want.has('R5')) {
    const r = checkR5(cap, 'T05', missesBefore, misses());
    r.adapted = 'Not built: no code in src/agent reads a "wrong" reply, writes a retraction or appends to testset/misses.yaml. Run as written, to record what the agent does today.';
    out.push(r);
  }
  if (want.has('R6')) out.push(checkR6(cap, 'T12'));
  if (want.has('R8')) out.push(checkR8(cap, 'T08'));
  return out;
}

// ── R7 (adapted) ───────────────────────────────────────────────────────────────────────────────────
const LIMIT = 3;
const CAP_USD = '0.001';
async function scenarioCaps(s: Scenario, cases: Case[]): Promise<RResult[]> {
  const demo = { CK_DEMO_ROOMS: s.prefix };
  await s.setup(['kash', 'priya', 'sam', 'rowan']);
  s.markBriefed(['rowan']);

  // R7a: the per-person demo limit.
  await s.start({ ...demo, CK_DEMO_PER_PERSON_HOUR: String(LIMIT) });
  await sleep(5000);
  const a = ['T01', 'T04', 'T05', 'T08', 'T02'].map((id, i) => ({ label: `L${i + 1}`, body: byId(cases, id).message }));
  for (const m of a) {
    const before = (s.agentLog(true).match(/demo_limit: /g) ?? []).length;
    await s.post('rowan', m.label, m.body);
    await until(`${m.label} decided or gated`, DECIDE_MS + 30_000, () => s.covered(m.label) || (s.agentLog(true).match(/demo_limit: /g) ?? []).length > before);
    await sleep(8000);
  }
  await s.stop();
  const capA = await s.capture();
  const r7a = checkR7a(capA, a.map((m) => m.label), LIMIT, LIMIT_LINE);

  // R7b: the daily spend cap, below one decision's cost (a fresh day's count: stop() moved the total
  // out of spend.json; the demo limits cleared too).
  rmSync(join(s.stateDir, 'demo-limits.json'), { force: true });
  s.marks.cap_usd = Number(CAP_USD);
  await s.start({ ...demo, CK_DAILY_SPEND_CAP_USD: CAP_USD });
  await sleep(5000);
  const b = [byId(cases, 'T12').message, byId(cases, 'T03').message, 'One more: could the dashboard show overdue totals per client?'].map((body, i) => ({ label: `Q${i + 1}`, body }));
  await s.post('rowan', b[0].label, b[0].body);
  await until('the spend cap note', DECIDE_MS, () => /spend: ⏸️/u.test(s.agentLog(true)));
  await until(`${b[0].label}'s gap to end`, GAP_S * 1000 + 30_000, () => /spend cap: burst in .* not decided|decision [0-9a-f-]+:/.test(s.agentLog(true)));
  await sleep(5000);
  for (const m of b.slice(1)) { await s.post('rowan', m.label, m.body); await sleep(15_000); }
  await sleep(10_000);
  await s.stop();
  const capB = await s.capture();
  return [r7a, checkR7b(capB, b.map((m) => m.label), PAUSED_LINE)];
}

function runR1(): RResult {
  const r = spawnSync('npx', ['vitest', 'run', 'test/offline/jobA.test.ts', '-t', 'R1 quote gate'], { cwd: ROOT, encoding: 'utf8', timeout: 180_000 });
  const out = `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
  const tests = out.match(/Tests\s+([^\n]+)/)?.[1]?.trim() ?? 'no summary';
  return {
    id: 'R1', title: 'Quote gate', how: 'offline unit test: npx vitest run test/offline/jobA.test.ts -t "R1 quote gate" (a fake model returns a quote that is not in the source, no citation, and a quote the reviewer rejects)',
    pass_when: 'no public covered; the trace shows gate_blocked or a downgrade to might-be-related', adapted: null,
    status: r.status === 0 && /passed/.test(tests) && !/failed/.test(tests) ? 'pass' : 'fail',
    evidence: [`vitest: ${tests}`],
  };
}

function resultPath(model: string): string {
  const day = new Date().toISOString().slice(0, 10);
  for (let i = 1; ; i++) {
    const p = join(ROOT, `testset/results/${day}-robustness-${model}${i === 1 ? '' : `-${i}`}.json`);
    if (!existsSync(p)) return p;
  }
}

export async function runRobustness(args: Args) {
  const want = new Set(whichChecks(args.robustness));
  incidents.length = 0;
  const { cases } = loadCases(ROOT, 'main');
  const started = new Date().toISOString();
  const results: RResult[] = [];
  if (want.has('R1')) { console.log('R1: running the offline quote-gate test'); results.push(runR1()); }
  const live = [...want].filter((x) => x !== 'R1');
  if (!live.length) return finish();
  const w = await prepare(args, () => `robustness ${[...want].join(', ')}`);
  const rooms: Room[] = [];
  const scenarios: Scenario[] = [];
  const run = async (tag: string, ids: string[], fn: (s: Scenario) => Promise<RResult[]>) => {
    if (!ids.some((x) => want.has(x))) return;
    const s = new Scenario(w, tag, rooms);
    scenarios.push(s);
    try { results.push(...await fn(s)); } catch (e) {
      const msg = (e as Error).message;
      s.log(`scenario failed: ${msg}`);
      for (const id of ids.filter((x) => want.has(x))) results.push({ id, title: 'harness error', how: tag, pass_when: '', adapted: null, status: 'error', evidence: [msg] });
      if (/ECONNREFUSED|fetch failed|isn't answering/i.test(msg)) throw e; // the forward is gone: stop
    } finally { await s.stop().catch(() => undefined); }
  };
  try {
    await run('r2', ['R2'], (s) => scenarioR2(s, cases));
    await run('ch', ['R3', 'R4', 'R5', 'R6', 'R8'], (s) => scenarioChain(s, cases, want));
    await run('cap', ['R7'], (s) => scenarioCaps(s, cases));
  } finally {
    for (const s of scenarios) stopAgent(s.agent, 'SIGKILL');
    if (!args.keep) for (const r of rooms) await w.gw.archive(r.id).then(() => log(w.runDir, `archived ${r.name}`)).catch((e) => log(w.runDir, `archive ${r.name}: ${e.message}`));
  }
  return finish(w, scenarios);

  function finish(w?: World, scenarios: Scenario[] = []) {
    const order = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7a', 'R7b', 'R7', 'R8'];
    results.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const traceAll = scenarios.flatMap((s) => s.trace());
    const tc = traceCost(traceAll);
    const metered = scenarios.reduce((a, s) => { s.noteSpend(); return { usd: a.usd + s.metered.usd, calls: a.calls + s.metered.calls }; }, { usd: 0, calls: 0 });
    const model = w?.env.model ?? process.env.CK_MODEL ?? null;
    const report: RobustnessReport = {
      schema: 'ck.robustness/1', run_id: w?.runId ?? 'offline', model, reviewer_model: process.env.CK_REVIEWER_MODEL || null,
      started_at: started, ended_at: new Date().toISOString(), results,
      cost: { trace_usd: tc.usd, trace_calls: tc.calls, metered_usd: scenarios.length ? Math.round(metered.usd * 10000) / 10000 : null, metered_calls: metered.calls,
        note: 'Metered = the agent\'s own spend meter (every answered model call, priced by src/agent/model.ts); the trace figure misses calls that never reached a trace line (killed mid-flight, replaced prefetches, the cap-crossing call).' },
      incidents: [...incidents],
      versions: { sha: git(['rev-parse', 'HEAD']), switch: w?.switchVersion ?? null, mattermost: w?.mmVersion ?? null },
    };
    const out = resultPath(model ?? 'unknown-model');
    const rel = relative(ROOT, out);
    const json = JSON.stringify(report, null, 2) + '\n';
    const md = robustnessMarkdown(report, rel);
    const secrets = knownSecrets(ROOT);
    assertNoSecrets(json, secrets, rel);
    assertNoSecrets(md, secrets, rel.replace(/\.json$/, '.md'));
    mkdirSync(join(ROOT, 'testset/results'), { recursive: true });
    writeFileSync(out, json);
    writeFileSync(out.replace(/\.json$/, '.md'), md);
    const dirty = git(['status', '--porcelain', '--untracked-files=no', '--', 'src', 'eval', 'prompts', 'seed', 'testset', 'demo']);
    const sha = git(['rev-parse', 'HEAD']);
    appendFacts(ROOT, robustnessFactRows(report, `npm run eval -- ${process.argv.slice(2).join(' ')}`.trim(), sha && dirty ? `${sha.slice(0, 7)}+changes` : sha, rel));
    console.log('\n' + md);
    for (const r of results) console.log(`${r.id} ${r.status.toUpperCase()}\n  ${r.evidence.join('\n  ')}`);
    console.log(`wrote ${rel}; appended facts.md`);
  }
}
