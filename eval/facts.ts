// facts: the eval appends its headline numbers to facts.md, one row per claim
// (claim · value · command · commit · timestamp). Only the eval writes these rows; the README, blog
// and video take their numbers from here. Every run appends, pass or fail: there's no best-of.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScoreResult } from './score.ts';

const HEADER = `# Facts

Every number the README, blog and video use, with the command that produced it. Rows are appended by
the eval (\`npm run eval\`), one run at a time, failures included; nobody edits them by hand.

| Claim | Value | Command | Commit | Timestamp |
|---|---|---|---|---|
`;

const frac = (g: { passed: number; total: number }) => `${g.passed}/${g.total}`;
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function factRows(r: ScoreResult, command: string, commit: string | null, resultsPath: string): string[] {
  const s = r.summary;
  const run = `${r.meta.set} set, ${r.meta.run_id} (${resultsPath})`;
  const rows: [string, string][] = [
    [`Eval overall, ${run}`, frac(s.overall)],
    [`Eval job A, ${run}`, s.job_a.total ? frac(s.job_a) : 'n/a'],
    [`Eval confident wrong, ${run}`, String(s.confident_wrong)],
    [`Eval citations verified, ${run}`, `${s.diagnostics.citations_verified.verified}/${s.diagnostics.citations_verified.cited}`],
    [`Eval median seconds to a reply, ${run}`, s.diagnostics.latency_s.p50 === null ? 'n/a' : `${s.diagnostics.latency_s.p50} (n=${s.diagnostics.latency_s.n})`],
    [`Eval model spend in USD (est. upper bound, prices as of ${r.meta.prices_as_of}), ${run}`, r.usage.est_cost_usd === null ? 'unknown model price' : r.usage.est_cost_usd.toFixed(4)],
  ];
  const ts = new Date().toISOString();
  return rows.map(([claim, value]) => `| ${cell(claim)} | ${cell(value)} | \`${cell(command)}\` | ${commit ? commit.slice(0, 7) + (commit.endsWith('+changes') ? '+changes' : '') : 'unknown'} | ${ts} |`);
}

export function appendFacts(root: string, rows: string[]): void {
  const f = join(root, 'facts.md');
  const text = existsSync(f) ? readFileSync(f, 'utf8') : HEADER;
  writeFileSync(f, text.replace(/\n*$/, '\n') + rows.join('\n') + '\n');
}
