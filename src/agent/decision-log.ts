// decision-log: the agent's own "Decision log" room document (design §6.5). Job B adds an entry
// when a decision is logged (the owner stated it, or confirmed a teammate's in the owner desk) and
// changes it when the owner fills in the action owner, due date or reopen-if. The document lives in
// Switch: created once with create_room_document, then rewritten with update_room_document. Only
// the creating agent can edit a room document, so nobody can quietly change the log.
// The text is a decision table in the same shape as the seeded plan's ("| D1 | confirmed | ..."), so
// job A cites a logged decision like any decision row ("decision-log.md §1 L2"), job D can name it
// as the decision a restriction clashes with, and a reopen request can quote its "Reopen if".
// Entries are keyed by the message that raised the decision; ids L1, L2, ... never change.
import type { DecisionRecord } from '../shared/trace.ts';

export const DECISION_LOG = 'Decision log';
export const DECISION_LOG_FILE = 'decision-log.md';
export const DECISION_LOG_COLUMNS = ['#', 'Status', 'Decision', 'Why', 'Decided by', 'Decided', 'Action owner', 'Due', 'Reopen if', 'Source'];
const NONE = '—';

export interface LogEntry {
  id: string; // "L1"
  decision: string;
  why: string;
  decided_by: string;
  decided: string; // YYYY-MM-DD
  action_owner: string; // "" = unassigned
  due: string; // YYYY-MM-DD or ""
  reopen_if: string;
  source: string; // the message id that raised it
  raised_by: string;
}

export interface LoggedDecision {
  roomId: string;
  roomName: string;
  record: DecisionRecord;
  why: string;
  sourceMessageId: string;
  raisedBy: string;
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Wed 4 Nov 2026, 16:01" (UTC): the form blocks.ts docDate() reads as the document's date. */
export const stamp = (d: Date) =>
  `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

/** One table cell: no pipes or line breaks (they'd break the row), empty shown as "—". */
const cell = (s: string) => (s ?? '').replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ').trim() || NONE;
const uncell = (s: string) => { const t = (s ?? '').trim(); return t === NONE ? '' : t; };

export function renderLog(roomName: string, entries: LogEntry[], at: Date): string {
  const head = [
    `# ${DECISION_LOG}`,
    '',
    `Decisions logged in ${roomName} by Context Keeper. An entry is added when the room owner states a decision or confirms one in the owner desk, and changes only when the owner fills in who does it, when, or what would reopen it. Only Context Keeper can edit this document. Last updated ${stamp(at)}`,
    '',
    '## §1 Decisions logged in this room',
    '',
    `| ${DECISION_LOG_COLUMNS.join(' | ')} |`,
    `|${DECISION_LOG_COLUMNS.map(() => '---').join('|')}|`,
  ];
  const rows = entries.map((e) => `| ${[
    e.id, 'confirmed', cell(e.decision), cell(e.why), cell(e.decided_by), cell(e.decided),
    e.action_owner.trim() ? cell(e.action_owner) : 'unassigned', cell(e.due), cell(e.reopen_if),
    `\`${e.source}\` (${cell(e.raised_by)})`,
  ].join(' | ')} |`);
  return [...head, ...rows, ''].join('\n');
}

/** Read the entries back from the document's text (so the log itself is the store: a restarted
 *  agent continues from what Switch holds). Rows it can't read are skipped. */
export function parseLog(text: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const c = line.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
    if (!/^L\d+$/.test(c[0]) || c.length < DECISION_LOG_COLUMNS.length) continue;
    const src = c[9].match(/^`([^`]+)`\s*(?:\((.*)\))?$/);
    out.push({
      id: c[0], decision: uncell(c[2]), why: uncell(c[3]), decided_by: uncell(c[4]), decided: uncell(c[5]),
      action_owner: c[6] === 'unassigned' ? '' : uncell(c[6]), due: uncell(c[7]), reopen_if: uncell(c[8]),
      source: src ? src[1] : uncell(c[9]), raised_by: src ? uncell(src[2] ?? '') : '',
    });
  }
  return out;
}

/** Add the decision, or update the entry raised by the same message. `changed` is false when the
 *  log already says exactly this (a retry, or "leave it"), so nothing is written. */
export function upsertEntry(entries: LogEntry[], d: Omit<LoggedDecision, 'roomId' | 'roomName'>): { entries: LogEntry[]; entry: LogEntry; changed: boolean; added: boolean } {
  const r = d.record;
  const fields = {
    decision: r.summary.trim().replace(/\.+$/, ''), why: (d.why ?? '').trim(), decided_by: r.decided_by, decided: r.date,
    action_owner: r.action_owner ?? '', due: r.due ?? '', reopen_if: r.reopen_if ?? '', source: d.sourceMessageId, raised_by: d.raisedBy,
  };
  const norm = (e: Omit<LogEntry, 'id'>) => JSON.stringify(parseLog(renderLog('x', [{ id: 'L0', ...e }], new Date(0)))[0]); // compare as written
  const i = entries.findIndex((e) => e.source === d.sourceMessageId);
  if (i >= 0) {
    const prior = entries[i];
    // An update keeps what was known and fills in what's new (never blanks a field).
    const next: LogEntry = { ...prior, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v)), id: prior.id };
    const { id: _a, ...a } = prior;
    const { id: _b, ...b } = next;
    if (norm(a) === norm(b)) return { entries, entry: prior, changed: false, added: false };
    const copy = [...entries];
    copy[i] = next;
    return { entries: copy, entry: next, changed: true, added: false };
  }
  const n = entries.reduce((m, e) => Math.max(m, Number(e.id.slice(1)) || 0), 0) + 1;
  const entry: LogEntry = { id: `L${n}`, ...fields };
  return { entries: [...entries, entry], entry, changed: true, added: true };
}

/** Call the agent's Decision log writer, if it has one. Never throws; returns the trace note (or null). */
export async function noteDecision(deps: { onDecisionLogged?: (d: LoggedDecision) => Promise<string> }, d: LoggedDecision): Promise<string | null> {
  if (!deps.onDecisionLogged) return null;
  try { return await deps.onDecisionLogged(d); } catch (e) { return `decision log: not written: ${(e as Error).message.slice(0, 120)}`; }
}
