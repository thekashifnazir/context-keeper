// evalagent: the eval runs the real agent code (src/agent/main.ts) under its own Switch identity,
// "context-keeper-eval", not the demo's "context-keeper". Why: Switch fans every event of a room out
// to all connections of the agents in it, and connect_to_room takes a room from any other session of
// the same agent. A listener already running as context-keeper (the live demo) would otherwise see
// the eval's messages, could answer them, and could be evicted from its own rooms by the eval.
// The identity is registered once on the self-hosted server (like scripts/server-up.sh does for
// context-keeper) and its id and key are appended to .env.local (mode 600, never printed).
import { appendFileSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readEnvFile, type Gateway } from './switchapi.ts';

export const EVAL_AGENT = 'context-keeper-eval';
export interface EvalAgent { name: string; id: string; key: string }

export async function ensureEvalAgent(root: string, gw: Gateway, api: string, log: (m: string) => void): Promise<EvalAgent> {
  const file = join(root, '.env.local');
  const env = { ...readEnvFile(file), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('CK_EVAL_AGENT_')) as [string, string][]) };
  const name = env.CK_EVAL_AGENT_NAME || EVAL_AGENT;
  if (env.CK_EVAL_AGENT_ID && env.CK_EVAL_AGENT_API_KEY) return { name, id: env.CK_EVAL_AGENT_ID, key: env.CK_EVAL_AGENT_API_KEY };
  if ((await gw.agents()).some((a) => a.name === name))
    throw new Error(`agent ${name} is registered on the server but this checkout has no CK_EVAL_AGENT_ID / CK_EVAL_AGENT_API_KEY in .env.local (copy them from the checkout that registered it)`);
  log(`registering the eval agent ${name} (once per server)`);
  const { key } = await gw.mintApiKey(name);
  const res = await fetch(`${api}/agents`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      name,
      description: 'Context Keeper under test: the same code as context-keeper, run only by the eval in ck-eval-* rooms.',
      connector_type: 'context-keeper',
      integration_profile: { connection_model: 'always_on', message_exchange: true, pre_invocation_mediation: [], post_invocation_mediation: [], event_reporting: [] },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`registering ${name}: ${res.status} ${text.slice(0, 200)}`);
  const agent = JSON.parse(text) as { id: string; api_key: string };
  const fresh = !existsSync(file);
  appendFileSync(file, `${fresh ? '# Never committed.\n' : ''}# The eval's own agent identity (eval/evalagent.ts)\nCK_EVAL_AGENT_NAME=${name}\nCK_EVAL_AGENT_ID=${agent.id}\nCK_EVAL_AGENT_API_KEY=${agent.api_key}\n`);
  chmodSync(file, 0o600);
  log(`eval agent ${name} registered; id and key saved to .env.local`);
  return { name, id: agent.id, key: agent.api_key };
}
