// restriction (job D): personal or project? Personal → a kind public acknowledgement, the plan
// stands, nothing to the owner. Project → the details go privately to the owner desk (the decision
// it clashes with, who raised it, the options), and the room sees only a neutral line written by
// code, so a clash id or a quote can never leak into public.
import { normalise } from '../../shared/quote.ts';
import type { Details } from '../pending.ts';
import { quoteLine } from '../handoff/text.ts';

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** The only public line for a project clash. Kash, 3 Nov: "only something neutral, like 'flagged to the owner'". */
export const neutralClashLine = (name: string) =>
  `Thanks, ${firstName(name)}. Noted, and I've flagged it to the owner. The plan stays as it is until they decide.`;

export const personalFallback = (name: string) => `Thanks, ${firstName(name)}, noted. The plan stays as it is.`;

const PRIVATE_WORDS = /\b(owner desk|privately|private note|in private|dm(?:'d|ed)?)\b/i;

/** A personal reply from the model, kept only if it stays personal: no talk of private routes. */
export function personalReply(modelReply: string, name: string): string {
  const r = modelReply.trim();
  return r && !PRIVATE_WORDS.test(r) ? r : personalFallback(name);
}

/** True when a public body would carry the clash's details: its id or any quoted source text. */
export function leaksClash(body: string, clashesWith: string | null, quotes: string[]): boolean {
  if (clashesWith && new RegExp(`\\b${clashesWith.replace(/[^\w]/g, '')}\\b`, 'i').test(body)) return true;
  const b = normalise(body);
  return quotes.map(normalise).some((q) => q.length >= 12 && b.includes(q));
}

/** The owner-desk note for a project clash. It must name the decision id (the eval checks it). */
export function clashNote(p: {
  n: number; roomName: string; raisedBy: string; text: string; clashesWith: string | null; details: Details; decisionText: string | null; messageRef: string;
}): string {
  const d = p.details;
  const lines = [
    `⚖️ **#${p.n} · Clash to rule on** · #${p.roomName}`,
    `**${p.raisedBy} said:** ${quoteLine(p.text, 400)}`,
    `**Clashes with ${p.clashesWith ?? 'an earlier decision'}**${p.decisionText ? `: ${p.decisionText}` : ''}`,
  ];
  if (d.summary) lines.push(`**The clash:** ${d.summary}`);
  if (d.why) lines.push(`**Why it was decided:** ${d.why}`);
  if (d.options.length) lines.push('**Options:**', ...d.options.map((o, i) => `${i + 1}. ${o}`));
  lines.push(`**Reply** in this thread (or start with #${p.n}) and I'll post your ruling back in their thread. The room got a neutral "flagged to the owner" reply; the plan stands until you rule.`);
  return lines.join('\n');
}
