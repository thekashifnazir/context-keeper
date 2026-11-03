import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARCHIVE_DOC, demoContent, roomInstructions, roomRules } from './content.ts';
import { renderTemplate } from './template.ts';

describe('seed content', () => {
  it('room rules drop the title and the HTML comment', () => {
    const rules = roomRules();
    expect(rules).not.toContain('<!--');
    expect(rules).not.toMatch(/^#/m);
    expect(rules.startsWith('In this room, the agent must always:')).toBe(true);
  });

  it('instructions name the owner on their own line', () => {
    expect(roomInstructions('kash')).toMatch(/\n\nRoom owner: kash \(/);
  });

  it('ledgerly seeds 6 documents, riverside 2, each ending with the Channel archive', () => {
    const led = demoContent('ledgerly');
    const riv = demoContent('riverside');
    expect(led.docs).toHaveLength(6);
    expect(riv.docs).toHaveLength(2);
    for (const c of [led, riv]) {
      expect(c.docs.at(-1)!.name).toBe(ARCHIVE_DOC);
      expect(new Set(c.docs.map((d) => d.name)).size).toBe(c.docs.length); // names must be unique in a room
    }
    // The archive is the history file verbatim, so message ids stay citable.
    expect(led.docs.at(-1)!.content).toBe(readFileSync('demo/ledgerly/chat-history.yaml', 'utf8'));
    expect(led.docs.at(-1)!.content).toContain('id: led-001');
  });

  it('the committed templates match what the generator writes (npm run seed -- --emit-templates)', () => {
    for (const demo of ['ledgerly', 'riverside'] as const) {
      const { file, yaml } = renderTemplate(demo);
      expect(readFileSync(file, 'utf8')).toBe(yaml);
      expect(yaml).not.toMatch(/^kickoff:|^\s+kickoff:/m); // Switch #1158
    }
  });
});
