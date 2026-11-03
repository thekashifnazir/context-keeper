// room: the room's record as data (docs + archive messages), and loading it from demo/<room>/.
// The live agent fills the same shape from Switch (room documents + the "Channel archive"),
// plus every live message as it arrives, so a proposal two minutes after a decision still matches.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export interface ArchiveMessage {
  id: string;
  at: string; // ISO-ish timestamp as written in the source
  author: string;
  text: string;
  thread?: string | null;
}
export interface RoomDoc {
  file: string; // e.g. "product.md"
  text: string;
}
export interface RoomRecord {
  name: string;
  docs: RoomDoc[];
  messages: ArchiveMessage[];
}

/** Parse a YAML data file (test set, demo content) with the `yaml` package, so a clean clone needs
 *  no Python libraries. YAML 1.2 core schema: timestamps stay strings, exactly as written. */
export function loadYaml(file: string): any {
  return parse(readFileSync(file, 'utf8'));
}

export const ROOM_DIRS: Record<string, string> = { 'ledgerly-pilot': 'ledgerly', 'riverside-build-night': 'riverside' };

/** Normalise "2026-10-06 10:30:00+01:00" / "2026-10-06T10:30:00+01:00" to a comparable epoch ms. */
export const toMs = (at: string): number => Date.parse(String(at).replace(' ', 'T'));

/** Load demo/<dir>: its docs and the seeded chat history before `asOf` (an as-of cutoff, so a case
 *  can't see the answer from its own future). */
export function loadDemoRoom(root: string, roomName: string, asOf?: string): RoomRecord {
  const dir = join(root, 'demo', ROOM_DIRS[roomName] ?? roomName);
  const hist = loadYaml(join(dir, 'chat-history.yaml'));
  const docs: RoomDoc[] = (hist.docs as string[]).map((p) => {
    const file = join(dir, p);
    return { file: p.split('/').pop()!, text: existsSync(file) ? readFileSync(file, 'utf8') : '' };
  }).filter((d) => d.text);
  const cutoff = asOf ? toMs(asOf) : Infinity;
  const messages: ArchiveMessage[] = (hist.messages as any[])
    .filter((m) => toMs(m.at) < cutoff)
    .map((m) => ({ id: m.id, at: String(m.at), author: m.author, text: m.text, thread: m.thread ?? null }));
  return { name: hist.room ?? roomName, docs, messages };
}
