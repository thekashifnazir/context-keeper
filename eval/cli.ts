// eval: replay the test set into fresh ck-eval-* rooms, capture, score with no LLM.
//   npm run eval -- --rescore <capture dir>   re-score a saved capture, no server needed
//   npm run eval -- [--fast] [--only T05,T08] [--set main|redteam|holdout] [--keep] [--attach]
//   npm run eval -- --robustness [R2,R7,…]   the §10b pass/fail checks (eval/robustness-live.ts)
// Every run is reported; there's no best-of. Red team and held-out are scored on their own line.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCapture } from './capture.ts';
import { contentSha256, loadCases, loadRoomContent, type CaseSet } from './content.ts';
import { caseLines, summaryMarkdown } from './report.ts';
import { score } from './score.ts';
import { assertNoSecrets, knownSecrets } from './secrets.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface Args {
  rescore: string | null;
  out: string | null;
  only: string[] | null;
  set: CaseSet;
  fast: boolean;
  keep: boolean;
  attach: boolean;
  readme: boolean;
  repeat: number;
  robustness: string | null;
  model: string | null;
  setupOnly: boolean;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = { rescore: null, out: null, only: null, set: 'main', fast: false, keep: false, attach: false, readme: false, repeat: 1, robustness: null, model: null, setupOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${k} needs a value`); return v; };
    if (k === '--rescore') a.rescore = val();
    else if (k === '--out') a.out = val();
    else if (k === '--only') a.only = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--set') { const s = val(); if (!['main', 'redteam', 'holdout'].includes(s)) throw new Error(`--set main|redteam|holdout, not ${s}`); a.set = s as CaseSet; }
    else if (k === '--fast') a.fast = true;
    else if (k === '--keep') a.keep = true;
    else if (k === '--attach') a.attach = true;
    else if (k === '--readme') a.readme = true;
    else if (k === '--repeat') a.repeat = Number(val());
    else if (k === '--robustness') a.robustness = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'all';
    else if (k === '--model') a.model = val();
    else if (k === '--setup-only') a.setupOnly = true;
    else throw new Error(`unknown flag ${k}`);
  }
  return a;
}

/** Score a capture directory. Pure apart from reading files: the same capture gives the same JSON. */
export function rescore(dir: string) {
  const capture = loadCapture(dir);
  const { cases, sha256 } = loadCases(ROOT, capture.meta.set);
  const rooms = Object.keys(capture.meta.rooms);
  // The agent's Decision log as Switch held it at the end of the run (eval/replay.ts captureSwitchDocs).
  const runDocs = (r: string) => join(dir, 'switch-docs', r);
  const content = Object.fromEntries(rooms.map((r) => [r, loadRoomContent(ROOT, r, runDocs(r))]));
  return score({ cases, content, capture, set_label: capture.meta.set, cases_sha256: sha256, content_sha256: contentSha256(ROOT, rooms, runDocs) });
}

export function writeResult(result: ReturnType<typeof rescore>, jsonPath: string): string {
  const json = JSON.stringify(result, null, 2) + '\n';
  const rel = relative(ROOT, resolve(jsonPath));
  const md = summaryMarkdown(result, rel);
  const secrets = knownSecrets(ROOT);
  assertNoSecrets(json, secrets, rel);
  assertNoSecrets(md, secrets, rel.replace(/\.json$/, '.md'));
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, json);
  writeFileSync(jsonPath.replace(/\.json$/, '.md'), md);
  return md;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.rescore) {
    const dir = resolve(args.rescore);
    const result = rescore(dir);
    const out = args.out ? resolve(args.out) : join(dir, 'score.json');
    const md = writeResult(result, out);
    console.log(caseLines(result));
    console.log('\n' + md);
    console.log(`wrote ${relative(ROOT, out)}`);
    return;
  }
  const { runLive } = await import('./replay.ts');
  await runLive(args);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`eval: ${e instanceof Error ? e.message : e}`); process.exit(1); });
}
