// secrets: every file the eval writes is scanned for the persona passwords and the agent's keys
// first (as Switch's scan-artifacts.sh does). A hit refuses the write and never prints the value.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY_NAMES = /^(SWITCH_AGENT_API_KEY|CK_EVAL_AGENT_API_KEY|SWITCH_REGISTRATION_KEY|ANTHROPIC_API_KEY|ELEVENLABS_API_KEY|SLACK_BOT_TOKEN|DISCORD_BOT_TOKEN|SWITCH_TRUST_API_KEY)=(.+)$/;

/** Secret values known on this machine: keys from .env and .env.local, persona passwords. */
export function knownSecrets(root: string): string[] {
  const out: string[] = [];
  for (const f of ['.env', '.env.local']) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(KEY_NAMES);
      if (m && m[2].trim().length >= 8) out.push(m[2].trim());
    }
  }
  // The server's own secrets (Gateway admin, Mattermost admin and user passwords, tokens).
  const server = join(process.env.CK_SERVER_DIR || join(root, 'server'), '.env');
  if (existsSync(server)) {
    for (const line of readFileSync(server, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]*(PASSWORD|KEY|TOKEN|SECRET)[A-Z0-9_]*)=(.+)$/);
      if (m && m[3].trim().length >= 8) out.push(m[3].trim());
    }
  }
  const personas = join(root, 'build/eval/personas.json');
  if (existsSync(personas)) {
    const d = JSON.parse(readFileSync(personas, 'utf8')) as { personas?: Record<string, { password?: string }> };
    for (const p of Object.values(d.personas ?? {})) if (p.password) out.push(p.password);
  }
  return out;
}

/** Throws (naming only the file) if any secret appears in the text. */
export function assertNoSecrets(text: string, secrets: string[], where: string): void {
  if (secrets.some((s) => s && text.includes(s))) throw new Error(`refusing to write ${where}: it contains a key or persona password`);
  if (/sk-ant-[A-Za-z0-9_-]{10,}/.test(text)) throw new Error(`refusing to write ${where}: it contains something shaped like an Anthropic key`);
}
