// Job D offline checks: personal → a kind public line, plan stands, nothing private; project → the
// details go only to the owner desk, the room sees a neutral line with no clash id or quote, and the
// owner's ruling comes back in the thread.
import { beforeEach, describe, expect, it } from 'vitest';
import { handleOwnerDesk } from '../../src/agent/owner-desk.ts';
import { decide } from '../../src/agent/pipeline.ts';
import { normalise } from '../../src/shared/quote.ts';
import { FakeClaude, verdictMessage } from '../fake-claude.ts';
import { ctx, details, FakePoster, jobItem, KASH, msg, OPUS, PRIYA, setup } from './jobs-fixture.ts';

let t: ReturnType<typeof setup>;
beforeEach(() => { t = setup('ck-jobD-'); });

const personal = () => verdictMessage(OPUS, ctx, [jobItem('m1', { job: 'D', restriction: 'personal', reply: 'Thanks Rowan, noted that mornings are hard for you. Priya runs the onboarding calls, so the plan stays as it is.' })], [{ blockId: 'pilot-plan.md §3.1' }]);
const project = (reply = '') => verdictMessage(OPUS, ctx, [jobItem('m1', {
  job: 'D', restriction: 'project', clashes_with: 'D2', reply,
  details: details({ summary: 'Cutting the pilot to one agency reverses D2.', why: 'Three keeps the loop tight; one is too small a sample.', options: ['Keep three agencies as decided', 'Drop to two agencies'] }),
})], [{ blockId: 'pilot-plan.md §2 D2' }, { blockId: 'led-012' }]);

describe('job D: personal', () => {
  it('a personal preference gets one kind thread reply, the plan stands, and nothing goes to the owner', async () => {
    const claude = new FakeClaude([{ model: OPUS, respond: personal() }]); // no reviewer: D has no strong verdict
    const poster = new FakePoster();
    await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', "I can't do calls before 10am, so onboarding calls need to start later.")]);
    claude.done();
    expect(poster.desk()).toEqual([]);
    expect(poster.pub()).toHaveLength(1);
    expect(poster.pub()[0].thread).toBe('m1');
    expect(poster.pub()[0].body).toMatch(/plan stays/);
    const [line] = t.traces();
    expect(line.kind).toBe('reply');
    expect(line.items[0]).toMatchObject({ job: 'D', restriction: 'personal', clashes_with: null });
    expect(line.posts.map((p) => p.route)).toEqual(['public_thread']);
  });

  it('a personal reply that talks about private routes is replaced by the plain line', async () => {
    const claude = new FakeClaude([{ model: OPUS, respond: verdictMessage(OPUS, ctx, [jobItem('m1', { job: 'D', restriction: 'personal', reply: "Noted, I've told the owner desk privately." })], []) }]);
    const poster = new FakePoster();
    await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'I need a vegetarian option.')]);
    expect(poster.pub()[0].body).toBe('Thanks, Rowan, noted. The plan stays as it is.');
  });
});

describe('job D: project clash', () => {
  it('details go only to the owner desk (naming D2, who raised it, the options); the public line is neutral', async () => {
    const claude = new FakeClaude([{ model: OPUS, respond: project() }]);
    const poster = new FakePoster();
    await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', "Honestly we can't take three agencies, it's too much. One is plenty.")]);
    claude.done();
    expect(poster.desk()).toHaveLength(1);
    const note = poster.desk()[0].body;
    expect(note).toMatch(/\bD2\b/);
    expect(note).toContain('Rowan said');
    expect(note).toContain("we can't take three agencies");
    expect(note).toContain('Three agencies, max 25 clients each');
    expect(note).toMatch(/\*\*Options:\*\*\n1\. Keep three agencies as decided\n2\. Drop to two agencies/);

    expect(poster.pub()).toHaveLength(1);
    const pub = poster.pub()[0];
    expect(pub.thread).toBe('m1');
    expect(pub.body).toMatch(/flagged it to the owner/);
    const [line] = t.traces();
    expect(line.items[0]).toMatchObject({ job: 'D', restriction: 'project', clashes_with: 'D2' });
    // The scorer's P4 leak rule: no clash id and none of the item's quotes in the public reply.
    expect(pub.body).not.toMatch(/\bD2\b/);
    for (const s of line.items[0].sources) expect(normalise(pub.body)).not.toContain(normalise(s.quote));
    expect(line.items[0].sources.length).toBeGreaterThan(0);
    expect(line.posts.map((p) => p.route).sort()).toEqual(['owner_private', 'public_thread']);
    expect(line.kind).toBe('reply');
    expect(t.deps(new FakeClaude([])).pending!.open().map((p) => p.kind)).toEqual(['D']);
  });

  it("the model's own public text is never used for a clash, even when it carries the details", async () => {
    const claude = new FakeClaude([{ model: OPUS, respond: project('Rowan, D2 says "Three agencies, max 25 clients each", so no.') }]);
    const poster = new FakePoster();
    await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'One agency is plenty.')]);
    expect(poster.pub()[0].body).not.toMatch(/D2|Three agencies/);
  });

  it('when the owner note fails, nothing public claims it was flagged', async () => {
    const claude = new FakeClaude([{ model: OPUS, respond: project() }]);
    const poster = new FakePoster();
    poster.failOwner = true;
    await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'One agency is plenty.')]);
    expect(poster.sent).toEqual([]);
    const [line] = t.traces();
    expect(line.kind).toBe('silence');
    expect(line.error).toMatch(/owner_note_failed/);
  });

  it("the owner's ruling is posted back in the original thread; a non-owner's reply is ignored", async () => {
    const poster = new FakePoster();
    await decide(t.deps(new FakeClaude([{ model: OPUS, respond: project() }]), poster), 'room1', 'ck-test', ctx, [msg('m1', 'One agency is plenty.')]);
    const noteEvent = 'ev1';
    expect(poster.sent[0].route).toBe('owner');

    const d = t.deps(new FakeClaude([]), poster);
    const ignored = await handleOwnerDesk(d, 'desk', 'ck-owner-desk', msg('o1', 'plan stands', PRIYA, 'Priya', { thread_id: noteEvent }));
    expect(ignored?.error).toMatch(/not the owner/);
    expect(poster.pub()).toHaveLength(1); // only the neutral line from before

    const ruled = await handleOwnerDesk(d, 'desk', 'ck-owner-desk', msg('o2', 'Plan stands.', KASH, 'Kash', { thread_id: noteEvent }));
    expect(ruled?.kind).toBe('reply');
    const back = poster.pub().at(-1)!;
    expect(back.room).toBe('room1');
    expect(back.thread).toBe('m1');
    expect(back.body).toBe('Update from Kash: The plan stands.');
    expect(d.pending!.open()).toEqual([]);
  });
});
