// talk-ideas: job E's hand-off status, in plain words, for the talk agent's prompt ("Ideas in
// progress"), so a caller can ask "what's the build status of my idea?". Read-only: it reads the
// hand-off store's file (state/handoff.json, written by the live chain on every change) through the
// store module and never writes it. Only this room's ideas. Unknown statuses (job E grows new ones)
// fall back to the status name, never a crash.
import { existsSync } from 'node:fs';
import { HandoffStore, type IdeaRecord } from '../agent/handoff/store.ts';
import { snapshotStamp } from './talk-agent.ts';

export interface TalkIdea {
  ref: string; // "I1"
  idea: string; // short
  raiser: string;
  status: string; // plain words
  changed: string; // when the status last changed, spoken-friendly
}

const short = (s: string, n = 140) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`;
};

/** "https://github.com/o/r/issues/12" → "GitHub issue 12" (the agent never reads a link out). */
const issueOf = (links: string[] | undefined): string | null => {
  const m = (links ?? []).map((l) => l.match(/github\.com\/[^/\s]+\/[^/\s]+\/(issues|pull)\/(\d+)/)).find(Boolean);
  return m ? `${m[1] === 'pull' ? 'GitHub pull request' : 'GitHub issue'} ${m[2]}` : (links?.length ? 'a link in the room' : null);
};

export function plainStatus(r: IdeaRecord, ownerName = 'Kash'): string {
  const done = issueOf(r.report?.links);
  const by = r.signoff?.by_name || r.sender_name;
  switch (r.status) {
    case 'noted': return `noted, waiting for ${ownerName}'s OK to build it`;
    case 'approved': return `approved by ${ownerName}, waiting to start`;
    case 'stalled': return `approved, but the hand-off to Claude Code is stuck; ${ownerName} has been told`;
    case 'not_permitted': return `approved, but Switch wouldn't let it be handed to Claude Code; ${ownerName} has been told`;
    case 'handed_off': return r.events?.nudge
      ? `being built by Claude Code, possibly waiting for ${ownerName}'s OK on a permission step`
      : 'being built by Claude Code';
    case 'timed_out': return 'with Claude Code, but no result yet after the time limit';
    case 'not_done': return `Claude Code couldn't finish it${r.report?.body ? ` (${short(r.report.body, 100)})` : ''}`;
    case 'awaiting_signoff': return `done${done ? ` (${done})` : ''}, waiting for ${r.sender_name} to sign it off`;
    case 'signed_off': return `done${done ? ` (${done})` : ''} and signed off by ${by}`;
    case 'reopened': return `reopened by ${by}${r.signoff?.text ? `: "${short(r.signoff.text, 100)}"` : ''}`;
    default: return String(r.status).replace(/_/g, ' ');
  }
}

/** When the idea's status last changed: the newest timestamp it carries. */
function changedAt(r: IdeaRecord): string {
  const ts = [r.at, r.approved?.at, r.handed_at, r.report?.at, r.signoff?.at].filter(Boolean).map((t) => Date.parse(String(t))).filter((n) => !Number.isNaN(n));
  return ts.length ? snapshotStamp(new Date(Math.max(...ts))) : '';
}

export function talkIdeas(records: IdeaRecord[], roomId: string, ownerName = 'Kash'): TalkIdea[] {
  return records
    .filter((r) => r.room_id === roomId)
    .sort((a, b) => Number(a.ref.replace(/\D/g, '')) - Number(b.ref.replace(/\D/g, '')))
    .map((r) => ({ ref: r.ref, idea: short(r.text), raiser: r.sender_name, status: plainStatus(r, ownerName), changed: changedAt(r) }));
}

/** This room's ideas from the store's file; [] when there's no file yet. Never writes. */
export function readTalkIdeas(file: string, roomId: string, ownerName = process.env.CK_OWNER_NAME || 'Kash'): TalkIdea[] {
  if (!existsSync(file)) return [];
  return talkIdeas(new HandoffStore(file).all(), roomId, ownerName);
}
