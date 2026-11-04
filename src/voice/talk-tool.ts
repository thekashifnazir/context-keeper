// talk-tool: the live half of "talk it through" (practice run PR20c, "hybrid: snapshot + live Switch":
// Kash, "so much better. Felt like I was actually able to get some stuff done."). The prompt holds the
// room's record as a snapshot; one fast webhook tool, whats_new, answers "what's happened since?" from
// the agent's live record (RoomMemory) and job E's ideas, mid-call. No Claude call: plain sentences
// built in code, cleaned for speech (PR20b: raw record text, § numbers and file names read aloud
// sounded choppy), so a lookup takes milliseconds plus the tunnel.
//
// Reaching it needs a public URL: Kash starts a cloudflared quick tunnel (Claude Code's auto mode
// blocks starting one), and the agent reads its URL from CK_TALK_TOOL_URL or the tunnel's log.
// While the tunnel answers, the tool is attached to the talk agent; when there's no tunnel (or it
// stops answering) it's detached and live.ts falls back to refreshing the prompt on each change.
// Provisioning follows the greatagent setup_agent.py pattern: the shared secret is an ElevenLabs
// workspace secret (sent as a header, never in the repo), the tool and secret ids live in
// state/voice-ids.json, and a new tunnel URL PATCHes the tool in place. Never a second agent.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname } from 'node:path';
import type { ArchiveMessage, RoomRecord } from '../agent/room.ts';
import { toMs } from '../agent/room.ts';
import { ElevenError, type Eleven } from './eleven.ts';
import { spokenClean } from './script.ts';
import { IDS_FILE, readIds, writeIds } from './talk-agent.ts';
import type { TalkIdea } from './talk-ideas.ts';

export const TOOL_NAME = 'whats_new';
export const TOOL_PATH = '/voice/whats_new';
export const SECRET_HEADER = 'x-ck-tool-secret';
export const DEFAULT_PORT = 8790; // 8787 is often a wrangler dev server
export const SECRET_FILE = 'state/talk-tool-secret';
const MAX_NEWS = 15;

// ---- the tunnel URL and the shared secret -----------------------------------------------------------

/** The public URL: CK_TALK_TOOL_URL, else the last trycloudflare.com URL in the tunnel's log. */
export function tunnelUrl(env: NodeJS.ProcessEnv = process.env, logFile = env.CK_TALK_TUNNEL_LOG || 'tunnel.log'): string | null {
  if (env.CK_TALK_TOOL_URL) return env.CK_TALK_TOOL_URL.replace(/\/+$/, '');
  if (!existsSync(logFile)) return null;
  const all = readFileSync(logFile, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
  return all?.at(-1) ?? null;
}

/** CK_TALK_TOOL_SECRET, else one made once and kept in state/ (gitignored, owner-only). */
export function toolSecret(env: NodeJS.ProcessEnv = process.env, file = SECRET_FILE): string {
  if (env.CK_TALK_TOOL_SECRET) return env.CK_TALK_TOOL_SECRET;
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dirname(file), { recursive: true });
  const s = randomBytes(24).toString('base64url');
  writeFileSync(file, s + '\n', { mode: 0o600 });
  return s;
}

/** Which secret value a stored secret id holds, without keeping the value: a short hash. */
export const secretFingerprint = (secret: string) => createHash('sha256').update(secret).digest('hex').slice(0, 12);

export function secretMatches(given: string | string[] | undefined, secret: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- provisioning ---------------------------------------------------------------------------------

export function whatsNewToolConfig(url: string, secretId: string) {
  return {
    type: 'webhook',
    name: TOOL_NAME,
    description: "Checks the team chat room live for anything after your notes' time: new messages, and where the team's ideas are (approved, being built, done, signed off). Use it when the caller asks what's new or what's happened since, asks about the latest on an idea or its build, or says they've seen something you don't have. Returns `news` and `ideas` as plain sentences: retell them briefly in your own words.",
    response_timeout_secs: 5,
    pre_tool_speech: 'auto',
    api_schema: {
      url: `${url.replace(/\/+$/, '')}${TOOL_PATH}`,
      method: 'POST',
      request_headers: { 'X-CK-Tool-Secret': { secret_id: secretId } },
      request_body_schema: {
        type: 'object',
        required: ['conversation_id'],
        properties: {
          conversation_id: { type: 'string', dynamic_variable: 'system__conversation_id' },
          room_id: { type: 'string', dynamic_variable: 'room_id' },
          since: { type: 'string', dynamic_variable: 'since' },
          topic: { type: 'string', description: "What the caller asked about, in a few words; empty if they just want what's new" },
        },
      },
    },
  };
}

/** The workspace secret and the whats_new tool for this URL, made once and then updated in place,
 *  and the tool attached to the agent. A stored id this key can't see (404/403) is recreated. */
export async function attachTool(el: Eleven, agentId: string, url: string, secret: string, idsFile = IDS_FILE): Promise<{ toolId: string; created: string[] }> {
  const ids = readIds(idsFile);
  const created: string[] = [];
  const fp = secretFingerprint(secret);
  if (!ids.tool_secret_id || ids.tool_secret_fp !== fp) {
    const r = (await el.request('POST', '/v1/convai/secrets', { type: 'new', name: `ck-talk-tool-secret-${fp.slice(0, 6)}`, value: secret })).json() as { secret_id: string };
    ids.tool_secret_id = r.secret_id;
    ids.tool_secret_fp = fp;
    created.push(`secret ${r.secret_id}`);
    writeIds(ids, idsFile);
  }
  const cfg = { tool_config: whatsNewToolConfig(url, ids.tool_secret_id) };
  let toolId = ids.whats_new_tool_id;
  if (toolId) {
    try { await el.request('PATCH', `/v1/convai/tools/${toolId}`, cfg); } catch (e) {
      if (!(e instanceof ElevenError) || ![403, 404].includes(e.status)) throw e;
      toolId = undefined;
    }
  }
  if (!toolId) {
    toolId = ((await el.request('POST', '/v1/convai/tools', cfg)).json() as { id: string }).id;
    created.push(`tool ${toolId}`);
    writeIds({ ...readIds(idsFile), whats_new_tool_id: toolId }, idsFile);
  }
  await el.request('PATCH', `/v1/convai/agents/${agentId}`, { conversation_config: { agent: { prompt: { tool_ids: [toolId] } } } });
  return { toolId, created };
}

/** No tunnel: the agent gets no webhook tool (a dead URL would be dead air mid-call). */
export async function detachTool(el: Eleven, agentId: string): Promise<void> {
  await el.request('PATCH', `/v1/convai/agents/${agentId}`, { conversation_config: { agent: { prompt: { tool_ids: [] } } } });
}

// ---- the answer -----------------------------------------------------------------------------------

export interface WhatsNewAnswer { notes_ran_to: string; now: string; new_messages: number; news: string; ideas: string }

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);
/** A chat message as a listener would want it: no links, markdown, ids or § numbers. */
const sayable = (text: string) => clip(spokenClean(text).replace(/\s*\n+\s*/g, ' '), 220);

/** What happened in the room after `sinceMs`: messages as plain sentences, newest last, and the
 *  ideas' statuses (those that changed since first). Built in code, no model call. */
export function whatsNew(record: RoomRecord | null, ideas: TalkIdea[] | null, sinceMs: number, nowMs: number): WhatsNewAnswer {
  const since = hhmm(sinceMs);
  const fresh: ArchiveMessage[] = (record?.messages ?? []).filter((m) => toMs(m.at) > sinceMs).sort((a, b) => toMs(a.at) - toMs(b.at));
  const shown = fresh.slice(-MAX_NEWS);
  const end = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);
  const lines = shown.map((m) => end(`At ${hhmm(toMs(m.at))} ${m.author}${m.thread ? ', replying in a thread,' : ''} said: ${sayable(m.text)}`));
  const news = !record ? "I can't see the room's messages just now."
    : !fresh.length ? `Nothing new in the room since ${since}.`
    : `${fresh.length === 1 ? 'One new message' : `${fresh.length} new messages`} since ${since}${fresh.length > shown.length ? `; the latest ${shown.length}` : ''}. ${lines.join(' ')}`;
  const idea = (i: TalkIdea) => `${i.ref}, ${i.raiser}'s idea, ${sayable(i.idea)}: ${i.status}${i.changed ? `, since ${i.changed.split(', ').pop()}` : ''}.`;
  const ideasText = ideas === null ? '' : !ideas.length ? 'No ideas from this room are in progress.' : ideas.map(idea).join(' ');
  return { notes_ran_to: since, now: hhmm(nowMs), new_messages: fresh.length, news, ideas: ideasText };
}

// ---- the local server -----------------------------------------------------------------------------

export interface ToolRequest { conversation_id?: string; room_id?: string; since?: string; topic?: string }
export interface ToolServerOptions {
  port?: number; // 0 = any free port (tests)
  host?: string;
  secret: string;
  answer: (req: ToolRequest) => WhatsNewAnswer;
  log?: (s: string) => void;
}

/** 127.0.0.1 only; the tunnel forwards to it. GET /health (no auth, says nothing about the room),
 *  POST /voice/whats_new (secret header required). */
export function startToolServer(o: ToolServerOptions): Promise<{ server: Server; port: number }> {
  const log = o.log ?? (() => {});
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, service: 'ck-talk-tool' });
    if (req.method !== 'POST' || req.url !== TOOL_PATH) return send(404, { error: 'not found' });
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size <= 65_536) chunks.push(c); });
    req.on('end', () => {
      let body: ToolRequest = {};
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { return send(400, { error: 'bad json' }); }
      if (!secretMatches(req.headers[SECRET_HEADER], o.secret)) {
        log(`whats_new: refused (bad or missing secret header) for ${body.conversation_id ?? 'unknown conversation'}`);
        return send(401, { error: 'unauthorised' });
      }
      const t0 = Date.now();
      try {
        const a = o.answer(body);
        log(`whats_new for ${body.conversation_id ?? '?'}${body.topic ? ` ("${String(body.topic).slice(0, 60)}")` : ''}: ${a.new_messages} new since ${a.notes_ran_to} (${Date.now() - t0} ms)`);
        send(200, a);
      } catch (e) {
        log(`whats_new failed: ${(e as Error).message}`);
        send(200, { notes_ran_to: '', now: '', new_messages: 0, news: "I couldn't check the room just now.", ideas: '' });
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port ?? DEFAULT_PORT, o.host ?? '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === 'object' && addr ? addr.port : (o.port ?? DEFAULT_PORT) });
    });
  });
}

/** Does the public URL reach our server? (GET /health through the tunnel.) */
export async function probeTunnel(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok && (await r.json() as { service?: string })?.service === 'ck-talk-tool';
  } catch { return false; }
}
