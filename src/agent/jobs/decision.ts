// decision (job B): the chat agreed something. Kash, 3 Nov: the owner desk gets what was agreed, why,
// the link, a suggested owner and date if the record supports them, and two options (take the
// suggestion, or tell me). The team sees one short line once the decision makers confirm.
// When the room owner states the decision himself, his message is the confirmation: the line posts
// straight away and nothing goes to the desk.
import type { Details } from '../pending.ts';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}

const sentence = (s: string) => { const t = s.trim(); return t && !/[.!?]$/.test(t) ? `${t}.` : t; };

/** The one short public line, once confirmed. */
export function loggedLine(p: { summary: string; owner: string; date: string; confirmedBy: string }): string {
  const bits = [`Logged as decided: ${sentence(p.summary)}`];
  if (p.owner) bits.push(`Owner: ${p.owner}.`);
  // Skip the date when the summary already says it ("... on Tue 24 Nov").
  if (p.date && !p.summary.includes(fmtDate(p.date).slice(4))) bits.push(`Date: ${fmtDate(p.date)}.`);
  bits.push(`(${p.confirmedBy}'s call.)`);
  return bits.join(' ');
}

/** The owner-desk note asking the decision makers to confirm. */
export function confirmNote(p: { n: number; roomName: string; raisedBy: string; text: string; details: Details; messageRef: string }): string {
  const d = p.details;
  const lines = [
    `#${p.n} · Decision to confirm in ${p.roomName}`,
    `Agreed: ${d.summary || p.text.trim()}`,
    `Why: ${d.why || 'no reason was given in the chat'}`,
    `Source: ${p.raisedBy}, ${p.messageRef}: "${p.text.trim()}"`,
    `Date: ${d.date ? fmtDate(d.date) : 'none given'}`,
    d.suggested_owner
      ? `1. Suggested owner: ${d.suggested_owner}${d.owner_basis ? ` (${d.owner_basis})` : ''}. Reply "confirm" to take it.`
      : '1. No owner suggested: nothing in the record says who fits best.',
    '2. Or tell me: a different owner ("owner Sam"), a different date, a correction, or "drop".',
    `Reply in this thread (or start with #${p.n}). Nothing is posted in the room until you confirm.`,
  ];
  return lines.join('\n');
}

export type PlainReading = { action: 'confirm' | 'drop'; owner: string; date: string } | null;

/** Plain owner replies that need no model call: "confirm", "yes", "owner Priya", "drop". */
export function readPlain(text: string, kind: 'B' | 'D'): PlainReading {
  const t = text.replace(/#\d+\b/g, '').trim();
  if (kind === 'B') {
    if (/^(drop|scrap|cancel|not a decision|ignore)\b/i.test(t)) return { action: 'drop', owner: '', date: '' };
    const owner = (t.match(/^(?:confirm(?:ed)?[,.]?\s+)?(?:owner|assign(?:ed)?(?: it)? to|give it to|make it)\s*[:=]?\s*([A-Z][\w'-]+)\s*\.?$/i) ?? [])[1];
    if (owner) return { action: 'confirm', owner: owner[0].toUpperCase() + owner.slice(1), date: '' };
    if (/^(yes|yep|yeah|ok|okay|confirm(?:ed)?|agreed?|approved?|go|lgtm|sounds good|👍|✅)[\s.!]*$/iu.test(t)) return { action: 'confirm', owner: '', date: '' };
    return null;
  }
  if (/^(the )?plan stands[\s.!]*$|^(keep (the )?plan|no change)[\s.!]*$/i.test(t)) return { action: 'confirm', owner: '', date: '' };
  return null;
}
