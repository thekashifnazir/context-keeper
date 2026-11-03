// verdict: tying citations to burst items by the "item: <id>" line, as the live model writes it.
import { describe, expect, it } from 'vitest';
import { buildRoomContext } from '../../src/agent/blocks.ts';
import type { RoomRecord } from '../../src/agent/room.ts';
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
