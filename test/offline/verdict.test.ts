// verdict: tying citations to burst items by the "item: <id>" line, as the live model writes it.
import { describe, expect, it } from 'vitest';
import { buildRoomContext } from '../../src/agent/blocks.ts';
import type { RoomRecord } from '../../src/agent/room.ts';
import { RECORD_VERDICT } from '../../src/agent/prompt.ts';
import { parseVerdict } from '../../src/agent/verdict.ts';
import { item, message } from '../fake-claude.ts';

const room: RoomRecord = {
  name: 'ck-test',
  docs: [{ file: 'product.md', text: '# Product\n\n## §2 Payment reminders\n- Automatic reminders at 3, 7 and 14 days overdue.\n\n## §3 Direct debit\n- Direct debit through GoCardless.\n' }],
  messages: [],
};
const ctx = buildRoomContext(room);
const cite = (blockText: string) => {
  for (let d = 0; d < ctx.table.length; d++) {
    const i = ctx.table[d].findIndex((b) => b.text.includes(blockText));
    if (i >= 0) return { type: 'content_block_location', cited_text: ctx.table[d][i].text, document_index: d, document_title: null, start_block_index: i, end_block_index: i + 1 };
  }
  throw new Error(`no block with ${blockText}`);
};

describe('parseVerdict item lines', () => {
  it.each([
    ['plain', (id: string) => `item: ${id}\nevidence: `],
    ['bold, as seen live (B1, 3 Nov)', (id: string) => `\n\n**item: ${id}**\nevidence: `],
    ['code span', (id: string) => `item: \`${id}\`\nevidence: `],
  ])('ties each burst citation to its item: %s', (_name, line) => {
    const a = 'sw_8effc48f86bb2bafbaad820b88dfcd63', b = 'sw_4f3348f27391fcf89ba0a2e17a96d67e';
    const msg = message('claude-opus-5-5', [
      { type: 'text', text: line(a), citations: null },
      { type: 'text', text: 'reminders', citations: [cite('Automatic reminders')] },
      { type: 'text', text: line(b), citations: null },
      { type: 'text', text: 'direct debit', citations: [cite('GoCardless')] },
      { type: 'tool_use', id: 'tu_1', name: 'record_verdict', input: { items: [item(a), item(b)] } },
    ], 'tool_use');
    const items = parseVerdict(msg, ctx, [a, b]);
    expect(items.map((i) => i.cited.map((c) => c.block.ref))).toEqual([['product.md §2'], ['product.md §3']]);
  });
});

describe('record_verdict new_part (Kash, 4 Nov: a related idea with a new part reaches the owner\'s list)', () => {
  const id = 'sw_8effc48f86bb2bafbaad820b88dfcd63';
  const parse = (over: Record<string, unknown>) => parseVerdict(message('claude-opus-5-5', [
    { type: 'text', text: `item: ${id}\nevidence: `, citations: [cite('Automatic reminders')] },
    { type: 'tool_use', id: 'tu_1', name: 'record_verdict', input: { items: [item(id, over)] } },
  ], 'tool_use'), ctx, [id])[0];

  it('is a required string in the strict tool schema', () => {
    const it0 = (RECORD_VERDICT.input_schema as any).properties.items.items;
    expect(it0.required).toContain('new_part');
    expect(it0.properties.new_part.type).toBe('string');
  });
  it('job A might-be-related keeps it as one short line (trimmed, full stop dropped)', () => {
    expect(parse({ verdict: 'might-be-related', new_part: '  a pay-now link\nin the reminder emails. ' }).new_part).toBe('a pay-now link in the reminder emails');
  });
  it('"" / "none" / missing → null', () => {
    for (const new_part of ['', 'none', 'N/A', undefined]) expect(parse({ verdict: 'might-be-related', new_part }).new_part).toBeNull();
  });
  it('any other verdict or job → null, whatever the model wrote', () => {
    expect(parse({ verdict: 'new', new_part: 'x' }).new_part).toBeNull();
    expect(parse({ verdict: 'covered', new_part: 'x' }).new_part).toBeNull();
    expect(parse({ job: 'B', verdict: 'decision', new_part: 'x' }).new_part).toBeNull();
  });
  it('a long one is capped', () => {
    expect(parse({ verdict: 'might-be-related', new_part: 'a'.repeat(400) }).new_part!.length).toBeLessThanOrEqual(161);
  });
});
