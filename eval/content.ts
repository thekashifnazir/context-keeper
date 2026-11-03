// content: the test set and the demo content the scorer checks citations against.
// A source resolves when it's a message id in the room's chat-history.yaml, or "<doc>.md §<n>"
// for a doc in demo/<room>/docs/ with a "## §<n>" heading. Section text runs to the next "## ".
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadYaml } from './yaml.ts';

export const ROOM_DIRS: Record<string, string> = { 'ledgerly-pilot': 'ledgerly', 'riverside-build-night': 'riverside' };
export type CaseSet = 'main' | 'redteam' | 'holdout';
export const SET_FILES: Record<CaseSet, string> = {
  main: 'testset/cases.yaml',
  redteam: 'testset/redteam/redteam.yaml',
  holdout: 'testset/holdout/holdout.yaml',
};

export interface Expect {
  job: 'A' | 'B' | 'D' | 'none';
  verdict?: string;
  restriction?: string;
  clashes_with?: string;
  sources?: string[];
  also_sources?: string[];
  routing?: 'owner_private_allowed' | 'owner_private_required';
  must_mention?: string[];
}
export interface Case {
  id: string;
  room: string;
  at: string;
  author: string;
  burst?: string;
  message: string;
  expect: Expect;
  also_expect?: string;
}

export interface RoomContent {
  messages: Map<string, string>; // seeded id -> text
  sections: Map<string, string>; // "product.md §2" -> section text (heading to next "## ")
}

export function loadCases(root: string, set: CaseSet): { cases: Case[]; sha256: string; file: string } {
  const file = SET_FILES[set];
  const raw = readFileSync(join(root, file));
  const data = loadYaml<{ cases: Case[] }>(join(root, file));
  return { cases: data.cases, sha256: createHash('sha256').update(raw).digest('hex'), file };
}

/** Split a markdown doc into its "## §n" sections. */
export function docSections(doc: string, text: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = text.split('\n');
  let key: string | null = null;
  let buf: string[] = [];
  const flush = () => { if (key) out.set(key, buf.join('\n')); };
  for (const line of lines) {
    if (line.startsWith('## ')) {
      flush();
      const m = line.match(/^## (§\d+)\b/);
      key = m ? `${doc} ${m[1]}` : null;
      buf = [line];
    } else if (key) buf.push(line);
  }
  flush();
  return out;
}

export function loadRoomContent(root: string, room: string): RoomContent {
  const dir = join(root, 'demo', ROOM_DIRS[room] ?? room);
  const hist = loadYaml<{ messages: { id: string; text: string }[] }>(join(dir, 'chat-history.yaml'));
  const messages = new Map(hist.messages.map((m) => [m.id, m.text]));
  const sections = new Map<string, string>();
  const docs = join(dir, 'docs');
  if (existsSync(docs)) {
    for (const f of readdirSync(docs).filter((f) => f.endsWith('.md')).sort()) {
      for (const [k, v] of docSections(f, readFileSync(join(docs, f), 'utf8'))) sections.set(k, v);
    }
  }
  return { messages, sections };
}

/** Hash of every file the scorer reads for a room, so a result says which content it was scored against. */
export function contentSha256(root: string, rooms: string[]): string {
  const h = createHash('sha256');
  for (const room of [...rooms].sort()) {
    const dir = join(root, 'demo', ROOM_DIRS[room] ?? room);
    h.update(readFileSync(join(dir, 'chat-history.yaml')));
    const docs = join(dir, 'docs');
    if (existsSync(docs)) for (const f of readdirSync(docs).filter((f) => f.endsWith('.md')).sort()) h.update(f).update(readFileSync(join(docs, f)));
  }
  return h.digest('hex');
}

/** The source text for a ref in this room, or null when it doesn't resolve. */
export function resolveRef(content: RoomContent, ref: string): string | null {
  return content.messages.get(ref) ?? content.sections.get(ref) ?? null;
}
