// probes: run the narrow reviewer over testset/reviewer-probes.yaml (P7). Each probe is a claim and
// a verbatim quote with an expected pass/block. Same reviewer call the pipeline makes, one probe per call.
//   npx tsx src/cli/probes.ts
import { loadEnv } from '../agent/env.ts';
import { callReviewer, costUsd, modelConfigFromEnv, realClaude, type Usage } from '../agent/model.ts';
import { loadYaml } from '../agent/room.ts';

loadEnv();
const cfg = modelConfigFromEnv();
const claude = realClaude();
const probes = loadYaml('testset/reviewer-probes.yaml').probes as { id: string; kind: string; claim: string; quote: string; quote_ref: string; expect: 'pass' | 'block' }[];
const usages: Usage[] = [];
let right = 0;
const wrongPass: string[] = [];
for (const p of probes) {
  let got: 'pass' | 'block' = 'block';
  let issue = '';
  try {
    const r = await callReviewer(claude, cfg, [{ id: p.id, claim: p.claim, quotes: [`[${p.quote_ref}] ${p.quote}`] }]);
    usages.push(r.usage);
    const rv = r.reviews.get(p.id);
    got = rv?.supports ? 'pass' : 'block';
    issue = rv?.issue ?? 'no result';
  } catch (e) {
    issue = `error: ${(e as Error).message}`;
  }
  const ok = got === p.expect;
  if (ok) right += 1;
  if (!ok && got === 'pass') wrongPass.push(p.id);
  console.log(`${ok ? 'ok  ' : 'MISS'} ${p.id} (${p.kind}) want ${p.expect} got ${got}${issue ? ` — ${issue}` : ''}`);
}
const cost = usages.reduce((a, u) => a + costUsd(u), 0);
console.log(`\nreviewer ${cfg.reviewerModel}: ${right}/${probes.length} probes right; wrongly passed (unsafe): ${wrongPass.length ? wrongPass.join(', ') : 'none'}; est. cost $${cost.toFixed(4)}`);
