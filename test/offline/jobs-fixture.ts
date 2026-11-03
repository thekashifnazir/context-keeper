// Shared fixture for the job B, C and D offline tests: a small pilot room (decision rows, roles), a
// recording poster with an owner desk, and helpers for the scripted fake Claude.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRoomContext } from '../../src/agent/blocks.ts';
import type { ModelConfig } from '../../src/agent/model.ts';
import { PendingStore } from '../../src/agent/pending.ts';
import type { Deps, Input } from '../../src/agent/pipeline.ts';
import type { Poster } from '../../src/agent/post.ts';
import type { RoomRecord } from '../../src/agent/room.ts';
import { AgentState } from '../../src/agent/state.ts';
import { readTrace, type TraceLine } from '../../src/shared/trace.ts';
import { FakeClaude, item, message } from '../fake-claude.ts';

export const OPUS = 'claude-opus-5-5';
export const HAIKU = 'claude-haiku-5-5';
export const cfg: ModelConfig = { model: OPUS, reviewerModel: HAIKU, effort: 'medium', fallback: false };
export const SELF = '@context-keeper:localhost';
export const KASH = '@switch-slack-conn-owner_demo:localhost';
export const ROWAN = '@switch-slack-conn-rowan_demo:localhost';
export const PRIYA = '@switch-slack-conn-priya_demo:localhost';
export const SAM = '@switch-slack-conn-sam_demo:localhost';

export const room: RoomRecord = {
  name: 'ck-test',
  docs: [{
    file: 'pilot-plan.md',
    text: [
      '# Ledgerly pilot plan', '', 'Owner: Kash. Last updated Fri 30 Oct 2026.', '',
      '## §2 Decisions', '',
      '| # | Status | Decision | Why | Rejected (and why) | Downside accepted | Reopen if | Source |',
      '|---|---|---|---|---|---|---|---|',
      '| D2 | confirmed | **Three agencies, max 25 clients each** | Support is Priya plus Kash; three keeps the loop tight | One agency (too small a sample) | Waiting-list agencies wait | Support capacity changes | `led-012` |',
      '', '## §3 Who does what',
      '- Priya: onboarding calls and pilot support.',
      '- Rowan: partner comms from 4 Nov (back from leave).',
      '',
    ].join('\n'),
  }],
  messages: [
    { id: 'led-012', at: '2026-10-06T11:00:00+01:00', author: 'Kash', text: 'Decision D2: three agencies, max 25 clients each. Support is Priya plus me.' },
    { id: 'led-013', at: '2026-10-07T09:00:00+01:00', author: 'Rowan', text: 'Off on leave from tomorrow, back 4 Nov.' },
    { id: 'led-020', at: '2026-11-02T17:10:00+00:00', author: 'Priya', text: 'Updated status.md: invoices, reminders and Stripe are tested.' },
  ],
};
export const ctx = buildRoomContext(room);

export class FakePoster implements Poster {
  sent: { route: 'public' | 'owner'; room: string | null; thread: string | null; body: string }[] = [];
  ownerRoom = { id: 'desk', name: 'ck-owner-desk' };
  failOwner = false;
  async thread(roomId: string, thread: string | null, body: string) { this.sent.push({ route: 'public', room: roomId, thread, body }); return `ev${this.sent.length}`; }
  async owner(body: string) {
    if (this.failOwner) throw new Error('owner desk unreachable');
    this.sent.push({ route: 'owner', room: 'desk', thread: null, body });
    return `ev${this.sent.length}`;
  }
  pub() { return this.sent.filter((s) => s.route === 'public'); }
  desk() { return this.sent.filter((s) => s.route === 'owner'); }
}

export function setup(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const traceFile = join(dir, 'trace.jsonl');
  const stateFile = join(dir, 'state.json');
  const pendingFile = join(dir, 'pending.json');
  const deps = (claude: FakeClaude, poster = new FakePoster(), extra: Partial<Deps> = {}): Deps => ({
    claude, cfg, system: 'sys', poster, state: new AgentState(stateFile), selfSenders: new Set([SELF]), traceFile,
    ownerSender: KASH, ownerName: 'Kash', pending: new PendingStore(pendingFile), ...extra,
  });
  const traces = (): TraceLine[] => (existsSync(traceFile) ? readTrace(readFileSync(traceFile, 'utf8')) : []);
  return { dir, traceFile, stateFile, pendingFile, deps, traces };
}

export const msg = (id: string, body: string, sender = ROWAN, sender_name = 'Rowan', extra: Partial<Input> = {}): Input =>
  ({ message_id: id, sender, sender_name, body, received_at: '2026-11-04T14:20:00Z', ...extra });

export const details = (over: Record<string, unknown> = {}) => ({ summary: '', why: '', date: '', action_owner: '', suggested_owner: '', owner_basis: '', reopen_if: '', options: [], ...over });
export const jobItem = (id: string, over: Record<string, unknown>) => item(id, { verdict: 'none', reply: '', details: details(), ...over });

export const briefMessage = (lines: { kind: string; text: string; block: string; quote: string }[]) =>
  message(OPUS, [{ type: 'tool_use', id: 'tu_b', name: 'write_brief', input: { lines } }], 'tool_use');

export const ownerReadingMessage = (r: { action: string; summary?: string; owner?: string; date?: string; reopen_if?: string; line?: string }) =>
  message(OPUS, [{ type: 'text', text: JSON.stringify({ summary: '', owner: '', date: '', reopen_if: '', line: '', ...r }) }]);
