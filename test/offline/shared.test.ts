import { describe, expect, it } from 'vitest';
import { normalise, quoteVerified } from '../../src/shared/quote.ts';
import { handoffStep, readTrace, TraceLine } from '../../src/shared/trace.ts';
import { docName, docUrl, githubAnchor, mdLink, messageLabel, sectionLabel, sectionName } from '../../src/shared/refs.ts';
import { buildRoomContext } from '../../src/agent/blocks.ts';
import { loadDemoRoom } from '../../src/agent/room.ts';
import { gateSources } from '../../src/agent/post.ts';

describe('quote rule', () => {
  it('normalises case, markup, quotes and spacing', () => {
    expect(normalise('  **We  chose** “weekly” _invoicing_ ')).toBe('we chose weekly invoicing');
  });
  it('verifies a long enough substring and rejects a short or absent one', () => {
    const src = 'Decision: we send reminders **every 7 days** after the due date.';
    expect(quoteVerified('reminders every 7 days', src)).toBe(true);
    expect(quoteVerified('7 days', src)).toBe(false);
    expect(quoteVerified('reminders every 3 days', src)).toBe(false);
  });
});

describe('trace', () => {
  const line: TraceLine = {
    schema: 'ck.trace/1', ts: '2026-11-03T21:00:00Z', decision_id: 'd1', room_id: 'r', room_name: 'n',
    kind: 'silence', trigger: 'message',
    inputs: [{ message_id: 'm1', sender: 'rowan', body: 'hi', received_at: '2026-11-03T21:00:00Z' }],
    burst: null,
    items: [{ message_id: 'm1', job: 'none', verdict: null, restriction: null, clashes_with: null, sources: [], decision_record: null, brief_for: null }],
    posts: [], model: null, error: null,
  };
  it('reads lines back and skips a torn last line', () => {
    const text = JSON.stringify(line) + '\n' + JSON.stringify(line).slice(0, 20);
    expect(readTrace(text)).toHaveLength(1);
  });
  it('job E: a line with a handoff object parses; an old line without one still does, and both give their step', () => {
    const e: TraceLine = {
      ...line, decision_id: 'uuid-1', kind: 'owner_note',
      items: [{ ...line.items[0], job: 'E' }],
      handoff: { step: 'noted', ref: 'I1', key: 'E:r:m1', attempt: 1, status: 'noted', build_room: null, target_status: null },
    };
    const old = { ...line, decision_id: 'E:handed_off:I1:ab12cd34' }; // written before 5 Nov: job 'none', step in the id
    const [a, b, c] = readTrace([e, old, line].map((l) => JSON.stringify(l)).join('\n'));
    expect(handoffStep(a)).toBe('noted');
    expect(a.items[0].job).toBe('E');
    expect(handoffStep(b)).toBe('handed_off');
    expect(b.handoff).toBeUndefined();
    expect(handoffStep(c)).toBeNull();
    expect(() => TraceLine.parse({ ...e, handoff: { ...e.handoff!, step: 'made_up' } })).toThrow();
  });
});

describe('sources people can read (Kash, 4 Nov, I9: "what do those squiggles mean … could you have links out")', () => {
  it('a document title and section heading, not a file name and § number', () => {
    expect(docName('Ledgerly: product overview')).toBe('Product overview');
    expect(docName('Ledgerly roadmap')).toBe('Ledgerly roadmap');
    expect(sectionName('§2 Decisions (each confirmed by Kash, with the reason)')).toBe('Decisions');
    expect(sectionName('§1 shipped-tested (tested with real partner data)')).toBe('Shipped-tested');
    expect(sectionLabel('Ledgerly: product overview', '§5 Client portal')).toBe('Product overview › Client portal');
    expect(messageLabel('Rowan', '2026-11-04T12:08:00Z')).toBe('Rowan, 4 Nov');
  });
  it("GitHub's heading anchors (checked against github.com's rendered docs)", () => {
    expect(githubAnchor('§5 Client portal')).toBe('5-client-portal');
    expect(githubAnchor('§2 Decisions (each confirmed by Kash, with the reason)')).toBe('2-decisions-each-confirmed-by-kash-with-the-reason');
    expect(githubAnchor('§1 Phase 2 (after the pilot, from Jan 2027): parked, not rejected')).toBe('1-phase-2-after-the-pilot-from-jan-2027-parked-not-rejected');
  });
  it('links only with CK_DOCS_BASE_URL set; a label that would break Slack\'s <url|label> is cleaned', () => {
    const was = process.env.CK_DOCS_BASE_URL;
    try {
      delete process.env.CK_DOCS_BASE_URL;
      expect(docUrl('demo/ledgerly/docs/product.md', '§5 Client portal')).toBeNull();
      process.env.CK_DOCS_BASE_URL = 'https://github.com/o/r/blob/main/';
      expect(docUrl('demo/ledgerly/docs/product.md', '§5 Client portal')).toBe('https://github.com/o/r/blob/main/demo/ledgerly/docs/product.md#5-client-portal');
      expect(docUrl(null, '§5 Client portal')).toBeNull();
      expect(mdLink('A [b] | c', 'https://x.test/a')).toBe('[A b c](https://x.test/a)');
      expect(mdLink('A', 'https://x.test/a b')).toBe('A');
      expect(mdLink('A', null)).toBe('A');
    } finally { if (was === undefined) delete process.env.CK_DOCS_BASE_URL; else process.env.CK_DOCS_BASE_URL = was; }
  });
  it('job A names a demo-room source by title › heading with its date, linked to the public copy', () => {
    const was = process.env.CK_DOCS_BASE_URL;
    try {
      process.env.CK_DOCS_BASE_URL = 'https://github.com/o/context-keeper/blob/main';
      const ctx = buildRoomContext(loadDemoRoom('.', 'ledgerly-pilot'));
      const block = ctx.table.flat().find((b) => b.blockId === 'product.md §5.1')!;
      const { verified } = gateSources([{ block, citedText: block.text }], ctx);
      expect(verified[0].ref).toBe('product.md §5'); // the trace keeps the raw ref for scoring
      expect(verified[0].source).toBe('[Product overview › Client portal](https://github.com/o/context-keeper/blob/main/demo/ledgerly/docs/product.md#5-client-portal) (20 Oct)');
      const msg = ctx.table.flat().find((b) => b.kind === 'message')!;
      expect(gateSources([{ block: msg, citedText: msg.text }], ctx).verified[0].source).toMatch(/^[A-Z][a-z]+, \d{1,2} [A-Z][a-z]{2}$/);
    } finally { if (was === undefined) delete process.env.CK_DOCS_BASE_URL; else process.env.CK_DOCS_BASE_URL = was; }
  });
});
