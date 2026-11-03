// content: what goes into a seeded room, read from the repo. One place, so the seed command and the
// generated Console templates (templates/*.template.yaml) can't drift apart.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const DEMOS = ['ledgerly', 'riverside'] as const;
export type Demo = (typeof DEMOS)[number];

export interface SeedDoc {
  name: string;
  description: string;
  instructions: string;
  content: string;
}

export interface DemoContent {
  demo: Demo;
  /** The room the template is named after (the story's channel name). */
  roomName: string;
  description: string;
  docs: SeedDoc[];
}

export const ARCHIVE_DOC = 'Channel archive';

/** The room rules Kash dictated, minus the title line and the HTML comment: the room's instructions. */
export function roomRules(root = '.'): string {
  const raw = readFileSync(join(root, 'prompts/room-rules.md'), 'utf8');
  return raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((l) => !/^#\s/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Room instructions = the rules, then one setup line naming the owner (the agent reads it; eval §2 step 5). */
export function roomInstructions(ownerUsername: string, root = '.'): string {
  return `${roomRules(root)}\n\nRoom owner: ${ownerUsername} (only this person confirms decisions or rules on clashes, in the owner desk).`;
}

export const DESK_INSTRUCTIONS =
  'Private desk between Context Keeper and the owner. Only the owner confirms decisions or rules on clashes.';

function titleOf(markdown: string, fallback: string): string {
  const m = markdown.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

const DESCRIPTIONS: Record<Demo, { roomName: string; description: string }> = {
  ledgerly: {
    roomName: 'ledgerly-pilot',
    description: 'Ledgerly pilot planning. Context Keeper points people at what the room already decided, with a cited source.',
  },
  riverside: {
    roomName: 'riverside-build-night',
    description: 'Riverside Build Night organisers. Context Keeper points people at what the room already decided, with a cited source.',
  },
};

export function demoContent(demo: Demo, root = '.'): DemoContent {
  const dir = join(root, 'demo', demo);
  const docs: SeedDoc[] = readdirSync(join(dir, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const content = readFileSync(join(dir, 'docs', f), 'utf8');
      const title = titleOf(content, f.replace(/\.md$/, ''));
      return {
        name: title,
        description: `${title} (seeded project document, ${f})`,
        instructions: 'A project document. Cite it by its name and section number (for example §3), quoting it word for word.',
        content,
      };
    });
  docs.push({
    name: ARCHIVE_DOC,
    description: 'The channel history before the live demo, with message ids (chat apps cannot backdate messages).',
    instructions:
      'The dated record of what was said in this room before now. Each message has an id (such as led-007), an author, a time and its text; ' +
      '`thread` is the id of the message it replies to. Cite a message by author, date and id, quoting it word for word.',
    content: readFileSync(join(dir, 'chat-history.yaml'), 'utf8'),
  });
  return { demo, ...DESCRIPTIONS[demo], docs };
}
