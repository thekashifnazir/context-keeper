// model: the two model calls per decision (the cited verdict, then the narrow reviewer), behind a
// small interface so offline tests can swap in a scripted fake (test/fake-claude.ts).
// 30 s per call, no SDK retries: the pipeline decides what a failure means (fail quiet, retry once).
import Anthropic from '@anthropic-ai/sdk';
import { BRIEF_NOTES, OWNER_REPLY_SYSTEM, RECORD_VERDICT, REVIEWER_SYSTEM, WRITE_BRIEF, briefRequestText, newMessagesText } from './prompt.ts';
import type { RoomContext } from './blocks.ts';

export const CALL_TIMEOUT_MS = 30_000;

/** The one method the pipeline needs. The real client and the fake both provide it. */
export interface Claude {
  create(params: Record<string, unknown>, opts: { timeout: number }): Promise<Anthropic.Message>;
}

export interface ModelConfig {
  model: string; // main (verdict) model
  reviewerModel: string;
  effort: 'low' | 'medium' | 'high';
  fallback: boolean; // server-side refusal fallback; off when the eval pins the model
}

export function modelConfigFromEnv(): ModelConfig {
  return {
    model: process.env.CK_MODEL || 'claude-opus-5-5',
    reviewerModel: process.env.CK_REVIEWER_MODEL || 'claude-haiku-5-5',
    effort: (process.env.CK_EFFORT as ModelConfig['effort']) || 'medium',
    fallback: process.env.CK_FALLBACK === '1',
  };
}

export function realClaude(): Claude {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: CALL_TIMEOUT_MS });
  return {
    create: (params, opts) => client.beta.messages.create(params as any, opts) as unknown as Promise<Anthropic.Message>,
  };
}

// ---- errors -------------------------------------------------------------------------------------

export type ErrorKind = 'fatal' | 'retryable' | 'bad_request';

/** 401/403 or out of credit → stop and alert once. 5xx, 429, timeouts, connection errors → fail quiet, retry once. */
export function errorKind(e: unknown): ErrorKind {
  const err = e as { status?: number; message?: string; name?: string };
  const msg = String(err?.message ?? '');
  if (err?.status === 401 || err?.status === 403) return 'fatal';
  if (err?.status === 400 && /credit balance|billing/i.test(msg)) return 'fatal';
  if (err?.status === 400 || err?.status === 404 || err?.status === 422) return 'bad_request';
  return 'retryable';
}

/** CK_FAULT=model_500 makes the next CK_FAULT_TIMES (default 1) verdict calls fail with a 500 (R4). */
let faultsFired = 0;
export const resetFaults = () => { faultsFired = 0; };
function maybeFault(): void {
  if (process.env.CK_FAULT !== 'model_500') return;
  const times = Number(process.env.CK_FAULT_TIMES ?? 1);
  if (faultsFired >= times) return;
  faultsFired += 1;
  const e = new Error('injected fault: model_500 (CK_FAULT)') as Error & { status: number };
  e.status = 500;
  throw e;
}

// ---- usage --------------------------------------------------------------------------------------

export interface Usage { model: string; input: number; cacheRead: number; cacheWrite: number; output: number; ms: number }

const usageOf = (msg: Anthropic.Message, ms: number): Usage => ({
  model: msg.model,
  input: msg.usage?.input_tokens ?? 0,
  cacheRead: msg.usage?.cache_read_input_tokens ?? 0,
  cacheWrite: msg.usage?.cache_creation_input_tokens ?? 0,
  output: msg.usage?.output_tokens ?? 0,
  ms,
});

// $ per million tokens: input, output, cache read, cache write (5 min = 1.25x input). From the claude-api skill (cached 6 Oct 2026).
const PRICES: Record<string, [number, number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
};
export function costUsd(u: Usage): number {
  const p = PRICES[u.model] ?? PRICES[Object.keys(PRICES).find((k) => u.model.startsWith(k)) ?? ''] ?? [0, 0, 0, 0];
  return (u.input * p[0] + u.output * p[1] + u.cacheRead * p[2] + u.cacheWrite * p[3]) / 1e6;
}

// ---- call 1: the cited verdict ------------------------------------------------------------------

export interface VerdictInput { message_id: string; sender: string; body: string; received_at: string; thread_id?: string | null }

export async function callVerdict(claude: Claude, cfg: ModelConfig, system: string, ctx: RoomContext, inputs: VerdictInput[]) {
  maybeFault();
  const params: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: 8000,
    system,
    tools: [RECORD_VERDICT],
    tool_choice: { type: 'auto' },
    output_config: { effort: cfg.effort },
    messages: [{ role: 'user', content: [...ctx.documents, { type: 'text', text: newMessagesText(inputs) }] }],
  };
  if (cfg.fallback) Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  const t0 = Date.now();
  const msg = await claude.create(params, { timeout: CALL_TIMEOUT_MS });
  return { msg, usage: usageOf(msg, Date.now() - t0) };
}

// ---- call 2: the narrow reviewer (sees only each claim and its quotes) ---------------------------

export interface Review { id: string; supports: boolean; issue: string }

/** One call for the whole decision (a burst's items are reviewed together), so a message costs at most 2 calls. */
export async function callReviewer(claude: Claude, cfg: ModelConfig, checks: { id: string; claim: string; quotes: string[] }[]): Promise<{ reviews: Map<string, Review>; usage: Usage }> {
  const params = {
    model: cfg.reviewerModel,
    max_tokens: 2000,
    system: REVIEWER_SYSTEM,
    output_config: {
      effort: 'medium',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object', additionalProperties: false, required: ['results'],
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false, required: ['id', 'supports', 'issue'],
                properties: { id: { type: 'string' }, supports: { type: 'boolean' }, issue: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    messages: [{
      role: 'user',
      content: JSON.stringify({ checks }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
    }],
  };
  const t0 = Date.now();
  const msg = await claude.create(params, { timeout: CALL_TIMEOUT_MS });
  const usage = usageOf(msg, Date.now() - t0);
  const reviews = new Map<string, Review>();
  if (msg.stop_reason === 'refusal') return { reviews, usage }; // no result = blocked
  const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('');
  const parsed = JSON.parse(text) as { results?: Review[] };
  for (const r of parsed.results ?? []) if (typeof r.supports === 'boolean') reviews.set(String(r.id), { id: String(r.id), supports: r.supports, issue: String(r.issue ?? '') });
  return { reviews, usage };
}

// ---- job C: the brief (one call; the reviewer runs after, inside postBrief) ---------------------

export interface BriefLine { kind: string; text: string; block: string; quote: string }

export async function callBrief(claude: Claude, cfg: ModelConfig, system: string, ctx: RoomContext, person: { name: string; kind: 'joiner' | 'returner'; since: string | null; first_message: string }): Promise<{ lines: BriefLine[]; usage: Usage }> {
  maybeFault();
  const params: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: 4000,
    system: `${system}\n\n${BRIEF_NOTES}`,
    tools: [WRITE_BRIEF],
    tool_choice: { type: 'tool', name: 'write_brief' },
    messages: [{ role: 'user', content: [...ctx.documents, { type: 'text', text: briefRequestText(person) }] }],
  };
  const t0 = Date.now();
  const msg = await claude.create(params, { timeout: CALL_TIMEOUT_MS });
  const usage = usageOf(msg, Date.now() - t0);
  const tool = msg.content.find((b) => b.type === 'tool_use' && b.name === 'write_brief') as Anthropic.ToolUseBlock | undefined;
  const raw = (tool?.input as { lines?: unknown[] } | undefined)?.lines;
  if (!Array.isArray(raw)) throw new Error(`no write_brief call (stop_reason ${msg.stop_reason})`);
  const s = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
  const lines = raw.map((l: any) => ({ kind: s(l?.kind), text: s(l?.text), block: s(l?.block), quote: s(l?.quote) })).filter((l) => l.text);
  return { lines, usage };
}

// ---- owner desk: what did the owner decide? (only when the plain-text rules can't tell) ----------

export interface OwnerReading { action: 'confirm' | 'drop' | 'unclear'; summary: string; owner: string; date: string; line: string }

export async function callOwnerReply(claude: Claude, cfg: ModelConfig, item: { kind: 'B' | 'D'; summary: string; suggested_owner: string; date: string; options: string[] }, reply: string): Promise<{ reading: OwnerReading; usage: Usage }> {
  const str = { type: 'string' };
  const params = {
    model: cfg.model,
    max_tokens: 1000,
    system: OWNER_REPLY_SYSTEM,
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object', additionalProperties: false, required: ['action', 'summary', 'owner', 'date', 'line'],
          properties: { action: { type: 'string', enum: ['confirm', 'drop', 'unclear'] }, summary: str, owner: str, date: str, line: str },
        },
      },
    },
    messages: [{ role: 'user', content: JSON.stringify({ item, owner_reply: reply }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }],
  };
  const t0 = Date.now();
  const msg = await claude.create(params, { timeout: CALL_TIMEOUT_MS });
  const usage = usageOf(msg, Date.now() - t0);
  const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('');
  const r = JSON.parse(text) as Partial<OwnerReading>;
  const action = r.action === 'confirm' || r.action === 'drop' ? r.action : 'unclear';
  return { reading: { action, summary: String(r.summary ?? ''), owner: String(r.owner ?? ''), date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) ? String(r.date) : '', line: String(r.line ?? '') }, usage };
}
