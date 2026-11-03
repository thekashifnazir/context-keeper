// decision (job B): the chat agreed something. Kash, 3 Nov: the owner desk gets what was agreed, why,
// the link, a suggested owner and date if the record supports them, and two options (take the
// suggestion, or tell me). The team sees one short line once the decision makers confirm.
// Who decided is kept apart from who does the work (agreed 3 Nov, DACI-style): when the room owner
// states the decision himself he is the approver, so the line posts straight away; the desk gets a
// note only when the work has no action owner or due date (suggesting an owner if the record
// supports one). The action owner never quietly defaults to the room owner. Every record carries
// "reopen if" when the record or the chat gives one; otherwise the desk note asks for it.
import type { Details } from '../pending.ts';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}

const sentence = (s: string) => { const t = s.trim(); return t && !/[.!?]$/.test(t) ? `${t}.` : t; };

/** The one short public line, once confirmed. owner = the action owner, date = when it's due. */
export function loggedLine(p: { summary: string; owner: string; date: string; reopenIf?: string; confirmedBy: string }): string {
  const bits = [`Logged as decided: ${sentence(p.summary)}`];
  if (p.owner) bits.push(`Owner: ${p.owner}.`);
  // Skip the date when the summary already says it ("... on Tue 24 Nov").
  if (p.date && !p.summary.includes(fmtDate(p.date).slice(4))) bits.push(`Date: ${fmtDate(p.date)}.`);
  if (p.reopenIf) bits.push(`Reopen if: ${sentence(p.reopenIf)}`);
  bits.push(`(${p.confirmedBy}'s call.)`);
  return bits.join(' ');
}

/** The follow-up line once the owner fills in what was missing from a decision already logged. */
export function updateLine(p: { summary: string; owner: string; date: string; reopenIf: string; confirmedBy: string }): string {
  const bits = [`Update on "${p.summary.trim().replace(/[.!?]+$/, '')}":`];
  if (p.owner) bits.push(`Owner: ${p.owner}.`);
  if (p.date) bits.push(`Date: ${fmtDate(p.date)}.`);
  if (p.reopenIf) bits.push(`Reopen if: ${sentence(p.reopenIf)}`);
  bits.push(`(${p.confirmedBy}'s call.)`);
  return bits.join(' ');
}

const ownerLines = (d: Details): string => d.action_owner
  ? `Action owner: ${d.action_owner} (named in the chat).`
  : d.suggested_owner
    ? `1. Suggested owner: ${d.suggested_owner}${d.owner_basis ? ` (${d.owner_basis})` : ''}. Reply "confirm" to take it.`
    : '1. No owner suggested: nothing in the record says who fits best. Who should do it?';
const reopenLine = (d: Details): string => d.reopen_if
  ? `Reopen if: ${d.reopen_if}`
  : 'Reopen if: not said. What would make this worth revisiting? Reply "reopen if ...".';

/** The owner-desk note asking the decision makers to confirm (a teammate stated the decision). */
export function confirmNote(p: { n: number; roomName: string; raisedBy: string; text: string; details: Details; messageRef: string }): string {
  const d = p.details;
  const lines = [
    `#${p.n} · Decision to confirm in ${p.roomName}`,
    `Agreed: ${d.summary || p.text.trim()}`,
    `Why: ${d.why || 'no reason was given in the chat'}`,
    `Source: ${p.raisedBy}, ${p.messageRef}: "${p.text.trim()}"`,
    `Date: ${d.date ? fmtDate(d.date) : 'none given'}`,
    reopenLine(d),
    ownerLines(d),
    '2. Or tell me: a different owner ("owner Sam"), a different date, a correction, or "drop".',
    `Reply in this thread (or start with #${p.n}). Nothing is posted in the room until you confirm.`,
  ];
  return lines.join('\n');
}

/** The owner stated the decision himself: it's logged in the thread already; ask only for what's missing. */
export function assignNote(p: { n: number; roomName: string; text: string; details: Details; messageRef: string }): string {
  const d = p.details;
  const missing = [!d.action_owner && 'owner', !d.date && 'due date'].filter(Boolean).join(' or ');
  const lines = [
    `#${p.n} · Decision logged in ${p.roomName}; it has no ${missing} yet`,
    `Logged: ${d.summary || p.text.trim()}`,
    `Source: you, ${p.messageRef}: "${p.text.trim()}"`,
    d.action_owner ? `Owner: ${d.action_owner}` : ownerLines(d),
    d.date ? `Date: ${fmtDate(d.date)}` : 'Due: none given. When is it due?',
    reopenLine(d),
    `Reply in this thread (or start with #${p.n}): ${d.suggested_owner && !d.action_owner ? '"confirm", ' : ''}"owner Sam", a date, a reopen-if, or "leave it". The decision itself is already logged; until you answer, the work stays unassigned.`,
  ];
  return lines.join('\n');
}

export type PlainReading = { action: 'confirm' | 'drop'; owner: string; date: string } | null;

/** Plain owner replies that need no model call: "confirm", "yes", "owner Priya", "drop". */
export function readPlain(text: string, kind: 'B' | 'D'): PlainReading {
  const t = text.replace(/#\d+\b/g, '').trim();
  if (kind === 'B') {
    if (/^(drop|scrap|cancel|not a decision|ignore|leave it)\b/i.test(t)) return { action: 'drop', owner: '', date: '' };
    const owner = (t.match(/^(?:confirm(?:ed)?[,.]?\s+)?(?:owner|assign(?:ed)?(?: it)? to|give it to|make it)\s*[:=]?\s*([A-Z][\w'-]+)\s*\.?$/i) ?? [])[1];
    if (owner) return { action: 'confirm', owner: owner[0].toUpperCase() + owner.slice(1), date: '' };
    if (/^(yes|yep|yeah|ok|okay|confirm(?:ed)?|agreed?|approved?|go|lgtm|sounds good|👍|✅)[\s.!]*$/iu.test(t)) return { action: 'confirm', owner: '', date: '' };
    return null;
  }
  if (/^(the )?plan stands[\s.!]*$|^(keep (the )?plan|no change)[\s.!]*$/i.test(t)) return { action: 'confirm', owner: '', date: '' };
  return null;
}
