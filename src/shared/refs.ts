// refs: how a cited source is named in text people read. The trace and the scorer use record refs
// ("product.md §2", "led-011", or a Switch message id, "sw_" + 32 hex); posts never show them (Kash,
// 4 Nov: an "Also:" line ended in a raw sw_ id; after I9: "what do those squiggles mean").
// Posts name a source by document title and heading, or by who said it and when (below).

/** A Switch message event id as the record carries it: never shown to people. */
export const isRawMessageId = (ref: string) => /^sw_[0-9a-z]{6,}$/i.test(ref.trim());

/** Every raw message id in a text (a test helper and a last check on user-facing lines). */
export const rawIdsIn = (text: string) => text.match(/\bsw_[0-9a-z]{6,}\b/gi) ?? [];

// ---- sources people can read (Kash, 4 Nov, I9: "what do those squiggles mean … product.md §5 …
// could you have links out to some of those as well?") ----------------------------------------------
// A post names a source by the room document's title and the section's heading ("Product overview ›
// Client portal"), not by file and § number, and links to it when the document has a public copy
// (CK_DOCS_BASE_URL + its repo path + the heading's anchor). A chat message is named by who said it
// and when ("Rowan, 4 Nov"): Switch gives agents no permalink to a chat message. The trace keeps the
// raw refs ("product.md §5", "led-011") for scoring; the scorer accepts either form as shown.

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-20…" → "20 Oct" (the date as written, no time-zone shift); null when undated. */
export const dayOf = (at: string | null | undefined) => (at && /^\d{4}-\d{2}-\d{2}/.test(at) ? `${Number(at.slice(8, 10))} ${MONTH[Number(at.slice(5, 7)) - 1]}` : null);

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A document's title as people say it: "Ledgerly: product overview" → "Product overview" (the
 *  project name before a colon is the room's own, so it adds nothing); "Ledgerly roadmap" stays. */
export function docName(title: string): string {
  const t = title.replace(/^#\s+/, '').trim();
  const m = t.match(/^[^:]{1,40}:\s+(.+)$/);
  return cap((m ? m[1] : t).trim());
}

/** A section heading as people say it: "§2 Decisions (each confirmed by Kash, with the reason)" →
 *  "Decisions"; "§1 shipped-tested (tested with real partner data)" → "Shipped-tested". */
export function sectionName(heading: string): string {
  const t = heading.replace(/^#+\s*/, '').replace(/^§\d+(\.\d+)?\s*/, '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return cap(t);
}

/** "Product overview › Client portal". */
export const sectionLabel = (docTitle: string, heading: string) => {
  const s = sectionName(heading);
  return s ? `${docName(docTitle)} › ${s}` : docName(docTitle);
};

/** A message as people find it: "Rowan, 4 Nov". */
export const messageLabel = (author: string | null | undefined, at: string | null | undefined) => {
  const day = dayOf(at);
  return author ? `${author}${day ? `, ${day}` : ''}` : `an earlier message${day ? `, ${day}` : ''}`;
};

/** GitHub's anchor for a markdown heading: lower case, punctuation dropped, spaces to hyphens
 *  ("§5 Client portal" → "5-client-portal"), checked against github.com's rendered docs. */
export const githubAnchor = (heading: string) =>
  heading.replace(/^#+\s*/, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

/** The public link to a section of a document, or null. CK_DOCS_BASE_URL is where the repo's files
 *  are served (e.g. https://github.com/<owner>/context-keeper/blob/main); unset → no links. */
export function docUrl(path: string | null | undefined, heading: string | null): string | null {
  const base = (process.env.CK_DOCS_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!base || !path || !/^https?:\/\//.test(base)) return null;
  const p = path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  return `${base}/${p}${heading ? `#${githubAnchor(heading)}` : ''}`;
}

/** A markdown link Switch's Slack bridge turns into <url|label> (and Mattermost reads as is). The
 *  label can't hold "]" or a line break, the URL no ")" or space; without a URL it's the plain label. */
export function mdLink(label: string, url: string | null | undefined): string {
  const l = label.replace(/[[\]]/g, '').replace(/[|<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return url && !/[\s)]/.test(url) ? `[${l}](${url})` : l;
}
