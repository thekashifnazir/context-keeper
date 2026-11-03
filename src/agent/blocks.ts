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
import type { RoomRecord } from './room.ts';

export interface BlockInfo {
  blockId: string; // e.g. "product.md §1.4", "pilot-plan.md §2 D1", "led-011"
  ref: string; // the scored ref: "product.md §1" or "led-011"
  headerLen: number;
  text: string; // full block text, header included
  body: string; // text without the header
  display: string; // what a post shows as the quote (verbatim pieces only)
  at: string | null; // ISO date or datetime, null if undated
  author: string | null; // archive messages only
  kind: 'message' | 'row' | 'bullet' | 'para';
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

  for (const doc of room.docs) {
    const infos: BlockInfo[] = [];
    const date = docDate(doc.text);
    const dateTag = `doc ${date ?? 'UNDATED'}`;
    const parts = doc.text.split(/^(?=## )/m);
    let columns: string | null = null;
    for (const part of parts) {
      const head = part.match(/^## (§\d+)\s*(.*)$/m);
      const sec = head ? head[1] : null;
      const title = head ? head[2].trim() : 'Header';
      const ref = sec ? `${doc.file} ${sec}` : `${doc.file} header`;
      sourceText.set(ref, part);
      const lines = (head ? part.slice(part.indexOf('\n') + 1) : part).split('\n');
      let bullet = 0;
      let para: string[] = [];
      const add = (blockId: string, tag: string, body: string, kind: BlockInfo['kind'], display: string, at: string | null) => {
        const header = `[${blockId} · ${title} · ${tag}] `;
        infos.push({ blockId, ref, headerLen: header.length, text: header + body, body, display: trimDisplay(display), at, author: null, kind });
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
            const src = (line.match(/`((?:led|riv)-\d{3})`/) ?? [])[1] ?? null;
            const at = src ? (msgAt.get(src) ?? date) : date;
            add(`${ref} ${c[0]}`, `${src ?? 'doc'} · ${at ?? 'UNDATED'}`, line.trim(), 'row', `${c[2]}: ${c[3]}`, at);
          } else if (!/^\|[\s|:-]+\|$/.test(line.trim())) {
            columns = `Decision table columns: ${c.join(' | ')}`;
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
  // One cache breakpoint after the last document: tools + system + the whole room are the cached prefix.
  if (documents.length) documents[documents.length - 1].cache_control = { type: 'ephemeral' };
  return { roomName: room.name, documents, table, sourceText };
}
