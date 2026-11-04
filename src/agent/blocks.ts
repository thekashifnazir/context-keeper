// blocks: lay the room record out as Citations API documents (testset/citation-blocks.md).
// One custom-content document per doc file and one "Channel archive" document. Every block
// carries its id and date inside its text, because document titles aren't citable.
//   archive: one block per message      [led-011 · Kash · 2026-10-06 10:30] <text>
//   doc:     one block per decision row  [pilot-plan.md §2 D1 · <section title> · led-011 · 2026-10-06] <raw row>
//            one block per bullet        [product.md §1.4 · <section title> · doc 2026-10-20] <bullet without "- ">
//            one block per paragraph     [pilot-plan.md §2 · <section title> · doc ...] <paragraph>
// Code keeps block → {ref, header_len, source text}, so the gate can strip the header and check
// the rest against the scored source (a doc section from its heading to the next "## ", or a message).
import type Anthropic from '@anthropic-ai/sdk';
import { DECISION_LOG_FILE } from './decision-log.ts';
import type { RoomRecord } from './room.ts';

export interface BlockInfo {
  blockId: string; // e.g. "product.md §1.4", "pilot-plan.md §2 D1", "led-011"
  ref: string; // the scored ref: "product.md §1" or "led-011"
  headerLen: number;
  text: string; // full block text, header included
  body: string; // text without the header
  display: string; // what a post shows as the quote (verbatim pieces only)
  at: string | null; // ISO date or datetime, null if undated
  author: string | null; // archive messages, and decision rows whose source message is known
  kind: 'message' | 'row' | 'bullet' | 'para';
  /** Decision rows: the table's column names, in order (the raw row alone doesn't say which cell is "Rejected"). */
  columns?: string[];
}

export interface RoomContext {
  roomName: string;
  documents: Anthropic.DocumentBlockParam[];
  table: BlockInfo[][]; // [document_index][block_index]
  sourceText: Map<string, string>; // ref → text the quote must be a substring of
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** "Last updated Mon 2 Nov 2026, 12:45" → "2026-11-02 12:45"; null when the doc has no date. */
export function docDate(text: string): string | null {
  const m = text.match(/Last updated (?:[A-Z][a-z]{2} )?(\d{1,2}) ([A-Z][a-z]{2})[a-z]* (\d{4})(?:, (\d{1,2}:\d{2}))?/);
  if (!m) return null;
  const d = `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
  return m[4] ? `${d} ${m[4]}` : d;
}

/** "2026-10-06T10:30:00+01:00" or "2026-10-06 10:30:00+01:00" → "2026-10-06 10:30" (as written, no tz shift). */
export const shortStamp = (at: string): string => String(at).replace('T', ' ').slice(0, 16);

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

function trimDisplay(s: string, max = 300): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')) + ' …';
}

export function buildRoomContext(room: RoomRecord): RoomContext {
  const documents: Anthropic.DocumentBlockParam[] = [];
  const table: BlockInfo[][] = [];
  const sourceText = new Map<string, string>();
  const msgAt = new Map(room.messages.map((m) => [m.id, shortStamp(m.at)]));
  const msgAuthor = new Map(room.messages.map((m) => [m.id, m.author]));

  for (const doc of room.docs) {
    const infos: BlockInfo[] = [];
    const date = docDate(doc.text);
    const dateTag = `doc ${date ?? 'UNDATED'}`;
    const parts = doc.text.split(/^(?=## )/m);
    let columns: string | null = null;
    let header: string[] | null = null;
    for (const part of parts) {
      const head = part.match(/^## (§\d+)\s*(.*)$/m);
      const sec = head ? head[1] : null;
      const title = head ? head[2].trim() : 'Header';
      const ref = sec ? `${doc.file} ${sec}` : `${doc.file} header`;
      sourceText.set(ref, part);
      const lines = (head ? part.slice(part.indexOf('\n') + 1) : part).split('\n');
      let bullet = 0;
      let para: string[] = [];
      const add = (blockId: string, tag: string, body: string, kind: BlockInfo['kind'], display: string, at: string | null, author: string | null = null) => {
        const head = `[${blockId} · ${title} · ${tag}] `;
        infos.push({ blockId, ref, headerLen: head.length, text: head + body, body, display: trimDisplay(display), at, author, kind, ...(kind === 'row' && header ? { columns: header } : {}) });
      };
      const flush = () => {
        if (para.length) add(ref, dateTag, para.join(' ').trim(), 'para', para.join(' ').trim(), date);
        para = [];
      };
      for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line.trim()) { flush(); continue; }
        if (line.startsWith('|')) {
          flush();
          const c = cells(line);
          if (/^[A-Z]\d+$/.test(c[0])) {
            // The row's source message: a seeded id, or (the Decision log) any message the record holds.
            const ticks = [...line.matchAll(/`([^`\s]+)`/g)].map((x) => x[1]);
            const src = ticks.find((x) => /^(?:led|riv)-\d{3}$/.test(x)) ?? ticks.find((x) => msgAt.has(x)) ?? null;
            const col = (name: string) => (header && header.includes(name) ? (c[header.indexOf(name)] ?? '').trim() : '');
            const decided = /^\d{4}-\d{2}-\d{2}$/.test(col('Decided')) ? col('Decided') : null;
            const at = src ? (msgAt.get(src) ?? decided ?? date) : (decided ?? date);
            const by = col('Decided by');
            const author = by && by !== '—' ? by : src ? (msgAuthor.get(src) ?? null) : null;
            const why = (c[3] ?? '').trim();
            add(`${ref} ${c[0]}`, `${src ?? 'doc'} · ${at ?? 'UNDATED'}`, line.trim(), 'row', why && why !== '—' ? `${c[2]}: ${why}` : c[2], at, author);
          } else if (!/^\|[\s|:-]+\|$/.test(line.trim())) {
            columns = `Decision table columns: ${c.join(' | ')}`;
            header = c;
          }
          continue;
        }
        if (/^\s*- /.test(line)) {
          flush();
          bullet += 1;
          const body = line.replace(/^\s*- /, '');
          add(`${ref.replace(/ header$/, '')}${sec ? `.${bullet}` : ''}`, dateTag, body, 'bullet', body, date);
          continue;
        }
        if (line.startsWith('# ')) continue; // the doc title
        para.push(line.trim());
      }
      flush();
    }
    if (!infos.length) continue;
    documents.push({
      type: 'document',
      title: doc.file,
      ...(columns ? { context: columns } : {}),
      source: { type: 'content', content: infos.map((b) => ({ type: 'text' as const, text: b.text })) },
      citations: { enabled: true },
    });
    table.push(infos);
  }

  const archive: BlockInfo[] = room.messages.map((m) => {
    const header = `[${m.id} · ${m.author} · ${shortStamp(m.at)}${m.thread ? ` · reply to ${m.thread}` : ''}] `;
    sourceText.set(m.id, m.text);
    return { blockId: m.id, ref: m.id, headerLen: header.length, text: header + m.text, body: m.text, display: trimDisplay(m.text), at: shortStamp(m.at), author: m.author, kind: 'message' };
  });
  if (archive.length) {
    documents.push({
      type: 'document',
      title: 'Channel archive',
      context: 'Every message posted in the room, oldest first. Header: [message id · author · date and time]',
      source: { type: 'content', content: archive.map((b) => ({ type: 'text' as const, text: b.text })) },
      citations: { enabled: true },
    });
    table.push(archive);
  }
  // Two cache breakpoints. The archive grows with every live message (and our own posts), so a
  // breakpoint only after it never matches the next call's prefix: every call wrote the whole room
  // to cache and none read it. The first breakpoint sits after the last room doc, before the
  // archive: tools + system + docs stay byte-identical between calls and are read from cache. The
  // second, after the archive, still covers back-to-back calls on an unchanged record (a retry).
  // The agent's own Decision log (last among the docs, src/agent/memory.ts) changes when a decision
  // is logged, so it gets its own breakpoint after the stable docs: a new entry costs one write of
  // the log, not of every doc before it. At most three breakpoints (the API allows four).
  const docCount = documents.length - (archive.length ? 1 : 0);
  const logAt = documents.findIndex((d) => d.title === DECISION_LOG_FILE);
  if (logAt > 0) documents[logAt - 1].cache_control = { type: 'ephemeral' };
  if (docCount > 0 && docCount < documents.length) documents[docCount - 1].cache_control = { type: 'ephemeral' };
  if (documents.length) documents[documents.length - 1].cache_control = { type: 'ephemeral' };
  return { roomName: room.name, documents, table, sourceText };
}

/** A decision row's cells by column name ("Reopen if" → its text), or null for any other block. */
export function rowFields(b: BlockInfo): Record<string, string> | null {
  if (b.kind !== 'row' || !b.columns) return null;
  const c = cells(b.body);
  return Object.fromEntries(b.columns.map((name, i) => [name, c[i] ?? '']));
}

/** What the reviewer reads for a cited block: its text, plus, for a decision row, the same cells
 *  labelled with their column names (only the record's own words, rearranged). */
export function reviewText(b: BlockInfo, cited: string = b.text): string {
  const f = rowFields(b);
  if (!f) return cited;
  return `${cited}\nThe same row by column: ${Object.entries(f).map(([k, v]) => `${k}: ${v}`).join(' · ')}`;
}
