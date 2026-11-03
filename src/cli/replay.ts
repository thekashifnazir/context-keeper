// replay: feed test cases through the real job A pipeline with the real model, offline (no Switch).
// Each case sees its room's demo docs plus the seeded chat history before the case's time; posts go
// to a recorder, not a room. Checks each result against the case's expect: job, verdict, and a
// verified citation (ref in expect.sources, quote verbatim in that source by src/shared/quote.ts,
// and visible in the post). Counts confident_wrong. One run, no best-of.
//   npx tsx src/cli/replay.ts --only T04,T05,T06,T07,T08,T09
// Not the eval (that's npm run eval, eval lane): no Switch rooms, no P4/P5 routing checks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRoomContext } from '../agent/blocks.ts';
import { loadEnv } from '../agent/env.ts';
import { costUsd, modelConfigFromEnv, realClaude, type Usage } from '../agent/model.ts';
import { decide, type Input } from '../agent/pipeline.ts';
import type { Poster } from '../agent/post.ts';
import { systemPrompt } from '../agent/prompt.ts';
import { loadDemoRoom, loadYaml, ROOM_DIRS } from '../agent/room.ts';
import { AgentState } from '../agent/state.ts';
import { normalise, quoteVerified } from '../shared/quote.ts';
import type { TraceLine } from '../shared/trace.ts';

loadEnv();
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const only = arg('--only')?.split(',').map((s) => s.trim());
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const traceFile = arg('--trace') ?? `state/replay/${stamp}.jsonl`;
const root = '.';

const cases = (loadYaml('testset/cases.yaml').cases as any[]).filter((c) => !only || only.includes(c.id));
if (!cases.length) { console.error('no cases selected'); process.exit(2); }

/** The scorer's view of a source, built straight from demo/ (not from the agent's block map). */
function sourceFor(roomName: string, ref: string): string | null {
  const dir = join(root, 'demo', ROOM_DIRS[roomName]);
  if (/^(led|riv)-\d+$/.test(ref)) {
    const m = (loadYaml(join(dir, 'chat-history.yaml')).messages as any[]).find((x) => x.id === ref);
    return m?.text ?? null;
  }
  const [doc, sec] = ref.split(' ');
  if (!sec?.startsWith('§')) return null;
  try {
    const text = readFileSync(join(dir, 'docs', doc), 'utf8');
    const m = text.match(new RegExp(`^## ${sec}\\b[\\s\\S]*?(?=^## |(?![\\s\\S]))`, 'm'));
    return m ? m[0] : null;
  } catch { return null; }
}

class RecordingPoster implements Poster {
  sent: { thread: string | null; body: string }[] = [];
  ownerRoom = { id: 'replay-owner-desk', name: 'replay-owner-desk' };
  async thread(_r: string, thread: string | null, body: string) { this.sent.push({ thread, body }); return `replay-${this.sent.length}`; }
  async owner(body: string) { this.sent.push({ thread: 'OWNER', body }); return `replay-owner-${this.sent.length}`; }
}

// Group a burst (consecutive cases sharing a burst id) into one decision.
const groups: any[][] = [];
for (const c of cases) {
  const last = groups.at(-1);
  if (c.burst && last && last[0].burst === c.burst) last.push(c);
  else groups.push([c]);
}

const cfg = { ...modelConfigFromEnv(), fallback: false }; // pinned: no server-side fallback in a scored run
const claude = realClaude();
const system = systemPrompt(root);
const usages: Usage[] = [];
const VERDICTS_NEEDING_CITATION = new Set(['covered', 'parked', 'contradicts-record', 'might-be-related']);
let passed = 0;
let confidentWrong = 0;
let scored = 0;

console.log(`replay: ${cases.length} case(s), model ${cfg.model} (effort ${cfg.effort}), reviewer ${cfg.reviewerModel}, trace ${traceFile}\n`);
for (const group of groups) {
  const first = group[0];
  const roomName = first.room;
  const ctx = buildRoomContext(loadDemoRoom(root, roomName, String(first.at)));
  const poster = new RecordingPoster();
  const inputs: Input[] = group.map((c) => ({
    message_id: c.id, sender: `@replay-${String(c.author).toLowerCase()}`, sender_name: c.author, body: c.message,
    received_at: new Date(String(c.at).replace(' ', 'T')).toISOString(), thread_id: null,
  }));
  const t0 = Date.now();
  const r = await decide({ claude, cfg, system, poster, state: new AgentState(null), selfSenders: new Set(['@context-keeper']), traceFile }, `replay-${roomName}`, roomName, ctx, inputs);
  const ms = Date.now() - t0;
  usages.push(...r.usages);
  const line: TraceLine | null = r.trace;
  const publicBody = (line?.posts ?? []).filter((p) => p.route !== 'owner_private').map((p) => p.body).join('\n');

  for (const c of group) {
    scored += 1;
    const it = line?.items.find((i) => i.message_id === c.id);
    const exp = c.expect;
    const job = it?.job ?? 'none';
    const verdict = exp.job === 'D' ? it?.restriction ?? null : it?.verdict ?? null;
    const want = exp.job === 'D' ? exp.restriction : exp.verdict ?? null;
    const verified = (it?.sources ?? []).filter((s) => {
      const src = sourceFor(roomName, s.ref);
      return src !== null && quoteVerified(s.quote, src) && (publicBody.includes(s.ref) || normalise(publicBody).includes(normalise(s.quote)));
    });
    const p1 = job === exp.job;
    const p2 = exp.job === 'none' ? true : verdict === want;
    const needsCite = VERDICTS_NEEDING_CITATION.has(String(want));
    const p3 = !needsCite || verified.some((s) => (exp.sources ?? []).includes(s.ref));
    const cw = it?.verdict === 'covered' && (['new', 'might-be-related'].includes(String(exp.verdict)) || verified.length === 0);
    if (cw) confidentWrong += 1;
    const ok = p1 && p2 && p3 && !cw;
    if (ok) passed += 1;
    const mustMention = (exp.must_mention ?? []) as string[];
    const missing = mustMention.filter((w) => !publicBody.toLowerCase().includes(w.toLowerCase()));
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id}  want ${exp.job}/${want ?? '-'} [${(exp.sources ?? []).join(', ')}]  got ${job}/${verdict ?? '-'} [${(it?.sources ?? []).map((s) => s.ref).join(', ')}]  verified-citation ${p3 ? 'ok' : 'MISSING'}${cw ? '  CONFIDENT-WRONG' : ''}  ${(ms / 1000).toFixed(1)}s`);
    for (const s of it?.sources ?? []) console.log(`     source ${s.ref}: "${s.quote.slice(0, 110)}${s.quote.length > 110 ? '…' : ''}"`);
    if (mustMention.length) console.log(`     must_mention ${mustMention.join(', ')}: ${missing.length ? `missing ${missing.join(', ')}` : 'ok'} (diagnostic)`);
  }
  if (line?.error) console.log(`     notes: ${line.error}`);
  for (const p of poster.sent) console.log(`     ${p.thread === 'OWNER' ? 'owner desk' : 'thread reply'}:\n       ${p.body.replace(/\n/g, '\n       ')}`);
  if (!poster.sent.length) console.log('     (posted nothing)');
}

const cost = usages.reduce((a, u) => a + costUsd(u), 0);
const sum = (k: keyof Usage) => usages.reduce((a, u) => a + (u[k] as number), 0);
console.log(`\nresult: ${passed}/${scored} passed, confident_wrong ${confidentWrong}`);
console.log(`model calls ${usages.length} (${[...new Set(usages.map((u) => u.model))].join(', ')}); tokens in ${sum('input')}, cache read ${sum('cacheRead')}, cache write ${sum('cacheWrite')}, out ${sum('output')}; est. cost $${cost.toFixed(4)}`);
process.exit(passed === scored && confidentWrong === 0 ? 0 : 1);
