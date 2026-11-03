import { describe, expect, it } from 'vitest';
import { ROOT } from './cli.ts';
import { loadCases } from './content.ts';
import { nameClashes } from './personas.ts';
import { plan } from './replay.ts';

describe('replay plan (eval-harness §2)', () => {
  const { cases } = loadCases(ROOT, 'main');
  const p = plan(cases);
  const ids = (room: string) => p.get(room)!.map((w) => w.map((m) => m.cases[0].id).join('+'));
  it('orders each room by `at`, not file order, with bursts as one window, T21–T24 included', () => {
    expect(ids('ledgerly-pilot')).toEqual(['T01+T02+T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T15', 'T10', 'T11', 'T12', 'T13', 'T14', 'T21', 'T22', 'T24']);
    expect(ids('riverside-build-night')).toEqual(['T16+T17+T18', 'T19', 'T20', 'T23']);
  });
  it('keeps the real gaps inside a burst', () => {
    expect(p.get('ledgerly-pilot')![0].map((m) => m.offset_ms)).toEqual([0, 8000, 14000]);
    expect(p.get('riverside-build-night')![0].map((m) => m.offset_ms)).toEqual([0, 7000, 15000]);
  });
  it('refuses persona names that equal an agent or the admin', () => {
    expect(nameClashes(['kash', 'rowan', 'context-keeper', 'admin'], ['context-keeper', 'claude-code'])).toEqual(['context-keeper', 'admin']);
  });
});
