// verdict: turn the cited response into items. The verdict comes from the record_verdict tool call;
// the evidence comes from the Citations API (cited_text + block location), never from the model's
// own words. Citations are tied to an item by the "item: <id>" line that precedes them.
import type Anthropic from '@anthropic-ai/sdk';
import type { BlockInfo, RoomContext } from './blocks.ts';

export interface Cited {
  block: BlockInfo;
  citedText: string; // exactly what the API returned for this block (header included)
}

export interface ModelItem {
  message_id: string;
  job: 'A' | 'B' | 'D' | 'none';
  verdict: string | null;
  restriction: string | null;
  clashes_with: string | null;
  claim: string;
  reply: string;
  credit: string;
  embedded_instruction: boolean;
  cited: Cited[];
}

export class ParseError extends Error {}

/** Split a citation over [start, end) blocks into one Cited per block, re-cutting cited_text by the
 *  known block texts (cited_text is the blocks joined). A piece that doesn't match is kept as-is,
 *  so the gate sees it and fails it. */
function citedBlocks(ctx: RoomContext, c: Anthropic.CitationContentBlockLocation & { start_block_index?: number }): Cited[] {
  const blocks = ctx.table[c.document_index];
  if (!blocks) return [];
  const start = c.start_block_index ?? c.end_block_index - 1;
  const out: Cited[] = [];
  let rest = c.cited_text;
  for (let i = start; i < c.end_block_index && blocks[i]; i++) {
    const b = blocks[i];
    const at = rest.indexOf(b.text);
    if (c.end_block_index - start === 1) out.push({ block: b, citedText: rest });
    else if (at >= 0) { out.push({ block: b, citedText: b.text }); rest = rest.slice(at + b.text.length); }
    else out.push({ block: b, citedText: '' });
  }
  return out;
}

export function parseVerdict(msg: Anthropic.Message, ctx: RoomContext, inputIds: string[]): ModelItem[] {
  if (msg.stop_reason === 'refusal') throw new ParseError('refusal');
  const cites = new Map<string, Cited[]>(inputIds.map((id) => [id, []]));
  let current = inputIds.length === 1 ? inputIds[0] : null;
  let tool: { items?: unknown[] } | null = null;
  for (const b of msg.content) {
    if (b.type === 'text') {
      for (const m of b.text.matchAll(/item:\s*([^\s]+)/g)) {
        const id = m[1].replace(/[`"'.,;:]+$/g, '');
        if (cites.has(id)) current = id;
      }
      for (const c of b.citations ?? []) {
        if (c.type !== 'content_block_location' || !current) continue;
        cites.get(current)!.push(...citedBlocks(ctx, c));
      }
    } else if (b.type === 'tool_use' && b.name === 'record_verdict') {
      tool = b.input as { items?: unknown[] };
    }
  }
  if (!tool || !Array.isArray(tool.items)) throw new ParseError(`no record_verdict call (stop_reason ${msg.stop_reason})`);
  const none = (v: unknown) => (v === 'none' || v === '' || v == null ? null : String(v));
  const byId = new Map((tool.items as any[]).map((it) => [String(it.message_id), it]));
  return inputIds.map((id) => {
    const it = byId.get(id);
    if (!it) throw new ParseError(`record_verdict has no item for ${id}`);
    const job = (['A', 'B', 'D', 'none'].includes(it.job) ? it.job : 'none') as ModelItem['job'];
    return {
      message_id: id,
      job,
      verdict: job === 'A' || job === 'B' ? none(it.verdict) : null,
      restriction: job === 'D' ? none(it.restriction) : null,
      clashes_with: job === 'D' ? none(it.clashes_with) : null,
      claim: String(it.claim ?? ''),
      reply: String(it.reply ?? ''),
      credit: String(it.credit ?? ''),
      embedded_instruction: Boolean(it.embedded_instruction),
      cited: cites.get(id) ?? [],
    };
  });
}
