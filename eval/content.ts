// content: the test set and the demo content the scorer checks citations against.
// A source resolves when it's a message id in the room's chat-history.yaml, or "<doc>.md §<n>"
// for a doc in demo/<room>/docs/ with a "## §<n>" heading. Section text runs to the next "## ".
// The agent's own Decision log is written during the run, so it isn't in demo/: the harness reads
// it back from Switch when the run ends (<run dir>/switch-docs/<room>/decision-log.md) and its
// sections resolve too ("decision-log.md §1"), checked against what the room actually held.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadYaml } from './yaml.ts';
import { messageLabel, sectionLabel } from '../src/shared/refs.ts';

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
  /** ref -> how a post names it for people (src/shared/refs.ts, the agent's own rule): "Product overview ›
   *  Client portal" for a section, "Rowan, 4 Nov" for a message. A citation counts as shown when its
   *  ref, this label, or its quote is in the post (5 Nov: posts stopped printing "product.md §5"). */
  labels?: Map<string, string>;
}

export function loadCases(root: string, set: CaseSet): { cases: Case[]; sha256: string; file: string } {
  const file = SET_FILES[set];
  const raw = readFileSync(join(root, file));
  const data = loadYaml<{ cases: Case[] }>(join(root, file));
  return { cases: data.cases, sha256: createHash('sha256').update(raw).digest('hex'), file };
}

/** Each "## §n" section's people-facing label: the doc's "# " title › the heading's words. */
export function sectionLabels(doc: string, text: string): Map<string, string> {
  const title = text.match(/^# (.+)$/m)?.[1]?.trim() ?? doc.replace(/\.md$/, '');
  const out = new Map<string, string>();
  for (const m of text.matchAll(/^## (§\d+)\b(.*)$/gm)) out.set(`${doc} ${m[1]}`, sectionLabel(title, `${m[1]}${m[2]}`));
  return out;
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

export function loadRoomContent(root: string, room: string, runDocsDir?: string): RoomContent {
  const dir = join(root, 'demo', ROOM_DIRS[room] ?? room);
  const hist = loadYaml<{ messages: { id: string; text: string; author?: string; at?: unknown }[] }>(join(dir, 'chat-history.yaml'));
  const messages = new Map(hist.messages.map((m) => [m.id, m.text]));
  const labels = new Map<string, string>(hist.messages.map((m) => [m.id, messageLabel(m.author ?? null, String(m.at ?? ''))]));
  const sections = new Map<string, string>();
  const docs = join(dir, 'docs');
  if (existsSync(docs)) {
    for (const f of readdirSync(docs).filter((f) => f.endsWith('.md')).sort()) {
      const text = readFileSync(join(docs, f), 'utf8');
      for (const [k, v] of docSections(f, text)) sections.set(k, v);
      for (const [k, v] of sectionLabels(f, text)) labels.set(k, v);
    }
  }
  // Documents the agent wrote into the room during the run (captured from Switch): never override a seeded one.
  if (runDocsDir && existsSync(runDocsDir)) {
    for (const f of readdirSync(runDocsDir).filter((f) => f.endsWith('.md')).sort()) {
      const text = readFileSync(join(runDocsDir, f), 'utf8');
      for (const [k, v] of docSections(f, text)) if (!sections.has(k)) sections.set(k, v);
      for (const [k, v] of sectionLabels(f, text)) if (!labels.has(k)) labels.set(k, v);
    }
  }
  return { messages, sections, labels };
}

/** Hash of every file the scorer reads for a room, so a result says which content it was scored against. */
export function contentSha256(root: string, rooms: string[], runDocsDir?: (room: string) => string): string {
  const h = createHash('sha256');
  for (const room of [...rooms].sort()) {
    const dir = join(root, 'demo', ROOM_DIRS[room] ?? room);
    h.update(readFileSync(join(dir, 'chat-history.yaml')));
    const docs = join(dir, 'docs');
    if (existsSync(docs)) for (const f of readdirSync(docs).filter((f) => f.endsWith('.md')).sort()) h.update(f).update(readFileSync(join(docs, f)));
    const run = runDocsDir?.(room);
    if (run && existsSync(run)) for (const f of readdirSync(run).filter((f) => f.endsWith('.md')).sort()) h.update(`run:${f}`).update(readFileSync(join(run, f)));
  }
  return h.digest('hex');
}

/** The source text for a ref in this room, or null when it doesn't resolve. */
export function resolveRef(content: RoomContent, ref: string): string | null {
  return content.messages.get(ref) ?? content.sections.get(ref) ?? null;
}
