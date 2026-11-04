// reopen (D4-2): someone challenges a recorded decision with new information that meets its
// "Reopen if" condition. The model says verdict "reopen"; code then decides what happens:
//   - the gate needs a verified quote of the decision row itself (no row, no reopen);
//   - the reviewer gets the claim, the quoted decision (with its "Reopen if" cell) and the new
//     message, and must find that the message reports something meeting that condition;
//   - the details go privately to the owner desk (job D's route): the decision and its "Reopen if"
//     quoted, what was said, and the question "reopen it or not?";
//   - the room gets one line written by code (thanks, it's with the owner, the plan stands) above
//     the decision's quote. Nothing changes until the owner rules; the ruling comes back in the
//     thread through handleOwnerDesk, like a clash ruling.
// If the desk note can't be sent, the verdict drops to might-be-related: we never say "I've asked
// the owner" for a note that didn't go.
import { rowFields, type BlockInfo } from '../blocks.ts';
import { firstName } from './restriction.ts';

/** The decision id of a row block ("pilot-plan.md §2 D1" → "D1"). */
export const decisionId = (b: BlockInfo): string => b.blockId.split(' ').at(-1) ?? b.blockId;

/** The row's "Reopen if" cell, markdown emphasis removed; "" when the table has none. */
export function reopenIf(b: BlockInfo): string {
  const f = rowFields(b);
  const key = f ? Object.keys(f).find((k) => /^reopen if$/i.test(k.trim())) : undefined;
  return key ? f![key].replace(/\*\*|__|`/g, '').trim() : '';
}

/** The only public line for a reopen request (the decision's quote is added below it by code). */
export function reopenLine(name: string, condition: string): string {
  const cond = condition ? ` Reopen if: ${condition.replace(/[.\s]+$/, '')}.` : '';
  return `Thanks, ${firstName(name)}. That's new information on a recorded decision, so I've asked the owner whether to reopen it. Until they decide, the plan stays as it is.${cond}`;
}

/** The owner-desk note: names the decision, quotes it and its "Reopen if", and asks the question. */
export function reopenNote(p: { n: number; roomName: string; raisedBy: string; text: string; messageRef: string; row: BlockInfo; claim: string }): string {
  const id = decisionId(p.row);
  const cond = reopenIf(p.row);
  return [
    `#${p.n} · Reopen request in ${p.roomName}`,
    `${p.raisedBy} said (${p.messageRef}): "${p.text.trim()}"`,
    `It's about ${id} (${p.row.ref}): ${p.row.display}`,
    `Reopen if: ${cond || '(the record gives no condition)'}`,
    p.claim ? `Why it may qualify: ${p.claim.trim()}` : '',
    `Should ${id} be reopened? The room has been told it's with you and the plan stands until you decide. Reply in this thread (or start with #${p.n}): "plan stands" to keep ${id}, or your ruling in a sentence, and I'll post it back in their thread.`,
  ].filter(Boolean).join('\n');
}
