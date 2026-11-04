import { describe, expect, it } from 'vitest';
import { normalise, quoteVerified } from '../../src/shared/quote.ts';
import { handoffStep, readTrace, TraceLine } from '../../src/shared/trace.ts';

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
