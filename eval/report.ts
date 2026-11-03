// report: the summary table for the README (PREP eval-harness §6), from a score result only.
import type { ScoreResult } from './score.ts';

const frac = (g: { passed: number; total: number }) => (g.total ? `${g.passed}/${g.total}` : 'n/a');

export function summaryMarkdown(r: ScoreResult, resultsPath: string): string {
  const s = r.summary;
  const label = s.set === 'main' ? 'Overall' : s.set === 'redteam' ? 'Red team (blind, scored apart)' : 'Held-out (blind, scored apart)';
  const bursts = Object.entries(s.bursts);
  const rows = [
    ['Measure', 'Result'],
    ['---', '---'],
    [label, frac(s.overall)],
    ['Job A (already covered?)', frac(s.job_a)],
    ['Job D (preference or constraint)', frac(s.job_d)],
    ['Job B (decision capture)', frac(s.job_b)],
    ['Stayed quiet', frac(s.quiet)],
    [`Bursts answered once${bursts.length ? ` (${bursts.map(([k]) => k).join(', ')})` : ''}`, bursts.length ? bursts.map(([, v]) => (v ? 'yes' : 'no')).join(', ') : 'n/a'],
    ['**Confident wrong**', `**${s.confident_wrong}**`],
    ['Citations verified (quote matches source, shown in the reply)', `${s.diagnostics.citations_verified.verified}/${s.diagnostics.citations_verified.cited}`],
  ];
  const table = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  const m = r.meta;
  const day = m.started_at.slice(0, 10);
  const line = `Run ${day}${m.model ? ` on ${m.model}` : ''}, ${m.mode}, ${s.overall.total} cases from the ${s.set} set. Raw results: ${resultsPath}`;
  return `${table}\n\n${line}\n`;
}

/** One line per case, for the terminal. */
export function caseLines(r: ScoreResult): string {
  return r.cases
    .map((c) => {
      const marks = (['P1', 'P2', 'P3', 'P4', 'P5'] as const).map((k) => `${k}:${c.rules[k].status}`).join(' ');
      const fails = (['P1', 'P2', 'P3', 'P4', 'P5'] as const).filter((k) => c.rules[k].status === 'fail').map((k) => `${k} ${c.rules[k].reason}`);
      return `${c.pass ? 'PASS' : 'FAIL'} ${c.id.padEnd(9)} ${marks}${fails.length ? `\n      ${fails.join('\n      ')}` : ''}`;
    })
    .join('\n');
}
