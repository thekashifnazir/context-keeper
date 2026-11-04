// Public demo rooms and the daily spend cap, offline: per-person and per-room hourly limits (and the
// owner never limited), the cap's notes and refusals, both kept across a restart, feature gating in a
// demo room, and nothing changed when the flags are unset. No network, no cost.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { briefVoice, demoConfigFromEnv, DemoLimiter, gateMessage, LIMIT_LINE, matchesRoom, PAUSED_LINE, roomFeatures, VOICE_CAP_LINE, type DemoConfig } from '../../src/agent/demo.ts';
import { costUsd, errorKind, usageOf } from '../../src/agent/model.ts';
import { decide, decideWithRetry } from '../../src/agent/pipeline.ts';
import { isSpendCapError, meteredClaude, SpendCapError, SpendMeter, spendMeterFromEnv, spendNote, type Crossing } from '../../src/agent/spend.ts';
import { FakeClaude, item, message, verdictMessage } from '../fake-claude.ts';
import { ctx, FakePoster, HAIKU, KASH, msg, OPUS, ROWAN, SAM, setup } from './jobs-fixture.ts';

const HOUR = 3_600_000;
const tmp = () => mkdtempSync(join(tmpdir(), 'ck-demo-'));
const clock = (start = Date.parse('2026-11-05T10:00:00Z')) => { const c = { t: start, now: () => c.t }; return c; };
const cfg = (over: Partial<DemoConfig> = {}): DemoConfig => ({ prefixes: ['try-context-keeper'], perPersonHour: 6, triesPerPersonHour: 20, perRoomHour: 40, exempt: new Set(), ...over });
// FakeClaude's usage: 100 input + 50 output tokens. On Opus 5.5 that is $0.0014 a call.
const CALL = costUsd(usageOf(message(OPUS, []), 0));

describe('flags unset: nothing changes', () => {
  it('no CK_DEMO_ROOMS → no demo config; no CK_DAILY_SPEND_CAP_USD → no cap; the gate always lets through', () => {
    expect(demoConfigFromEnv({})).toBeNull();
    expect(demoConfigFromEnv({ CK_DEMO_ROOMS: ' , ' })).toBeNull();
    const dir = tmp();
    expect(spendMeterFromEnv(dir, {}).cap).toBeNull();
    expect(spendMeterFromEnv(dir, { CK_DAILY_SPEND_CAP_USD: '0' }).cap).toBeNull();
    expect(spendMeterFromEnv(dir, { CK_DAILY_SPEND_CAP_USD: 'off' }).cap).toBeNull();
    expect(gateMessage({ roomId: 'r', demo: false, sender: ROWAN, meter: null, limiter: null })).toEqual({ go: true });
  });

  it('defaults: 6 replies and 20 decisions per person, 40 replies per room, per hour', () => {
    const c = demoConfigFromEnv({ CK_DEMO_ROOMS: 'try-context-keeper, ck-demo-', CK_DEMO_EXEMPT: 'owner_discord' })!;
    expect(c.prefixes).toEqual(['try-context-keeper', 'ck-demo-']);
    expect([c.perPersonHour, c.triesPerPersonHour, c.perRoomHour]).toEqual([6, 20, 40]);
    expect(c.exempt.has('owner_discord')).toBe(true);
    expect(demoConfigFromEnv({ CK_DEMO_ROOMS: 'x', CK_DEMO_PER_PERSON_HOUR: '3', CK_DEMO_PER_ROOM_HOUR: '10' })).toMatchObject({ perPersonHour: 3, perRoomHour: 10 });
    expect(spendMeterFromEnv(tmp(), { CK_DAILY_SPEND_CAP_USD: '6' }).cap).toBe(6);
  });
});

describe('which rooms are demo rooms', () => {
  it('matches the full Switch name or the channel part after "Guild: "', () => {
    expect(matchesRoom('try-context-keeper', ['try-context-keeper'])).toBe(true);
    expect(matchesRoom('Context Keeper: try-context-keeper', ['try-context-keeper'])).toBe(true);
    expect(matchesRoom('Context Keeper: try-context-keeper', ['Context Keeper: try-'])).toBe(true);
    expect(matchesRoom('Ledgerly: ledgerly-pilot', ['try-context-keeper'])).toBe(false);
    expect(matchesRoom('', ['try-'])).toBe(false);
  });

  it('job E and voice are off in a demo room whatever the global flags; other rooms keep theirs', () => {
    const all = { jobE: true, audioBrief: true, talkLink: true };
    expect(roomFeatures(all, true)).toEqual({ jobE: false, audioBrief: false, talkLink: false });
    expect(roomFeatures(all, false)).toBe(all);
  });
});

describe('voice in demo rooms (CK_DEMO_VOICE)', () => {
  it('off unless CK_DEMO_VOICE=1; default 15 clips + links a day', () => {
    expect(demoConfigFromEnv({ CK_DEMO_ROOMS: 'x' })).toMatchObject({ voice: false, voicePerDay: 15 });
    expect(demoConfigFromEnv({ CK_DEMO_ROOMS: 'x', CK_DEMO_VOICE: '0' })!.voice).toBe(false);
    expect(demoConfigFromEnv({ CK_DEMO_ROOMS: 'x', CK_DEMO_VOICE: '1', CK_DEMO_VOICE_PER_DAY: '4' })).toMatchObject({ voice: true, voicePerDay: 4 });
  });

  it('with the flag, voice follows the global flags in a demo room; job E stays off', () => {
    const all = { jobE: true, audioBrief: true, talkLink: true };
    expect(roomFeatures(all, true, false)).toEqual({ jobE: false, audioBrief: false, talkLink: false });
    expect(roomFeatures(all, true, true)).toEqual({ jobE: false, audioBrief: true, talkLink: true });
    expect(roomFeatures({ jobE: true, audioBrief: false, talkLink: true }, true, true)).toEqual({ jobE: false, audioBrief: false, talkLink: true });
    expect(roomFeatures(all, false, true)).toBe(all);
  });

  it('one voice brief per person per UTC day; the next day it is open again', () => {
    const c = clock();
    const l = new DemoLimiter(cfg({ voice: true, voicePerDay: 15 }), null, c.now);
    expect(l.takeVoice(ROWAN, 2)).toBe(true);
    expect(l.takeVoice(ROWAN, 2)).toBe(false);
    expect(l.takeVoice(SAM, 2)).toBe(true);
    expect(l.voiceUsedToday()).toBe(4);
    c.t += 24 * HOUR;
    expect(l.voiceUsedToday()).toBe(0);
    expect(l.takeVoice(ROWAN, 2)).toBe(true);
  });

  it('the day total caps clips + links across everyone; the owner is not per-person limited but counts', () => {
    const c = clock();
    const l = new DemoLimiter(cfg({ voice: true, voicePerDay: 5, exempt: new Set(['owner_discord']) }), null, c.now);
    expect(l.takeVoice(KASH, 2, null, KASH)).toBe(true);
    expect(l.takeVoice(KASH, 2, null, KASH)).toBe(true); // owner: no per-person limit
    expect(l.takeVoice(ROWAN, 2)).toBe(false); // 4 + 2 > 5
    expect(l.takeVoice(ROWAN, 1)).toBe(true); // a link only fits
    expect(l.takeVoice(SAM, 1)).toBe(false);
    expect(l.takeVoice('x', 1, 'owner_discord')).toBe(false); // exempt, but the day is full
    expect(l.voiceUsedToday()).toBe(5);
  });

  it('the voice counts survive a restart, next to the hourly limits in the same file', () => {
    const file = join(tmp(), 'demo-limits.json');
    const c = clock();
    const a = new DemoLimiter(cfg({ voice: true, voicePerDay: 3 }), file, c.now);
    expect(a.takeVoice(ROWAN, 2)).toBe(true);
    a.noteReply('r', ROWAN);
    const b = new DemoLimiter(cfg({ voice: true, voicePerDay: 3 }), file, c.now);
    expect(b.voiceUsedToday()).toBe(2);
    expect(b.takeVoice(ROWAN, 1)).toBe(false); // had today's voice brief before the restart
    expect(b.takeVoice(SAM, 2)).toBe(false); // 2 + 2 > 3
    expect(b.takeVoice(SAM, 1)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8')).voice).toMatchObject({ day: '2026-11-05', total: 3 });
  });

  it('what a brief gets: no voice and no talk line without the flag; voice under the caps; the cap line over them; Slack rooms untouched', () => {
    const all = { jobE: true, audioBrief: true, talkLink: true };
    const l = new DemoLimiter(cfg({ voice: true, voicePerDay: 3 }), null, clock().now);
    const b = (sender: string, voice = true, demo = true) => briefVoice({ demo, rf: roomFeatures(all, demo, voice), talkAgent: true, limiter: l, sender });
    expect(b(ROWAN, false)).toEqual({ voice: false, closing: '' });
    expect(l.voiceUsedToday()).toBe(0); // nothing taken without the flag
    expect(b(ROWAN)).toEqual({ voice: true, closing: '' }); // the talk link replaces the closing
    expect(b(ROWAN)).toEqual({ voice: false, closing: VOICE_CAP_LINE, capped: true }); // second today
    expect(b(SAM)).toEqual({ voice: false, closing: VOICE_CAP_LINE, capped: true }); // 2 + 2 > 3
    expect(VOICE_CAP_LINE).toBe("Voice catch-ups have hit today's demo limit — back tomorrow.");
    expect(b(SAM, true, false)).toEqual({ voice: true }); // a Slack room: no cap, usual closing
    expect(l.voiceUsedToday()).toBe(2);
  });
});

describe('per-person and per-room limits', () => {
  it('6 replies to one person in an hour → the 7th message gets the limit line once, then silence; an hour later it is open again', () => {
    const c = clock();
    const l = new DemoLimiter(cfg(), null, c.now);
    for (let i = 0; i < 6; i++) { expect(l.check('r', ROWAN)).toBe('ok'); l.noteTry('r', ROWAN); l.noteReply('r', ROWAN); c.t += 60_000; }
    expect(l.check('r', ROWAN)).toBe('notify');
    expect(l.check('r', ROWAN)).toBe('silent');
    c.t += 30 * 60_000;
    expect(l.check('r', ROWAN)).toBe('silent');
    expect(l.check('r', SAM)).toBe('ok'); // someone else is not limited
    expect(l.check('other-room', ROWAN)).toBe('ok'); // per room
    c.t += HOUR;
    expect(l.check('r', ROWAN)).toBe('ok');
  });

  it('silent decisions count too, up to the tries limit (each one is a model call)', () => {
    const l = new DemoLimiter(cfg({ triesPerPersonHour: 3 }), null, clock().now);
    for (let i = 0; i < 3; i++) l.noteTry('r', ROWAN);
    expect(l.check('r', ROWAN)).toBe('notify');
  });

  it('the room limit caps everyone together (a brief counts for the room only)', () => {
    const l = new DemoLimiter(cfg({ perRoomHour: 3 }), null, clock().now);
    l.noteReply('r', ROWAN); l.noteReply('r', SAM); l.noteReply('r', null);
    expect(l.check('r', '@someone-new')).toBe('notify');
    expect(l.check('r', SAM)).toBe('notify'); // once per person, not once per room
    expect(l.check('r', SAM)).toBe('silent');
  });

  it('never applies to the owner, nor to CK_DEMO_EXEMPT (by sender id or handle)', () => {
    const l = new DemoLimiter(cfg({ perPersonHour: 1, perRoomHour: 1, exempt: new Set(['owner_discord']) }), null, clock().now);
    l.noteReply('r', KASH); l.noteReply('r', KASH);
    expect(l.check('r', KASH, 'owner_demo', KASH)).toBe('ok');
    expect(l.check('r', '@switch-discord-x-owner_discord:localhost', 'owner_discord', KASH)).toBe('ok');
    expect(l.check('r', ROWAN, 'rowan', KASH)).toBe('notify');
  });

  it('the counts survive a restart', () => {
    const file = join(tmp(), 'demo-limits.json');
    const c = clock();
    const a = new DemoLimiter(cfg({ perPersonHour: 2 }), file, c.now);
    a.noteReply('r', ROWAN); a.noteReply('r', ROWAN);
    expect(a.check('r', ROWAN)).toBe('notify');
    const b = new DemoLimiter(cfg({ perPersonHour: 2 }), file, c.now);
    expect(b.check('r', ROWAN)).toBe('silent'); // already told this hour, before the restart
  });
});

describe('daily spend cap', () => {
  it('one owner note at 80%, one at 100%, then every call is refused before it is sent', async () => {
    const meter = new SpendMeter({ file: null, cap: 0.003, now: clock().now });
    const fake = new FakeClaude([1, 2, 3].map(() => ({ model: OPUS, respond: message(OPUS, [{ type: 'text', text: 'x' }]) })));
    const seen: Crossing[] = [];
    const claude = meteredClaude(fake, meter, (c) => seen.push(c));
    await claude.create({ model: OPUS }, { timeout: 1 });
    expect(seen).toEqual([]);
    await claude.create({ model: OPUS }, { timeout: 1 }); // $0.0028 ≥ 80% of $0.003
    expect(seen).toEqual(['warn']);
    await claude.create({ model: OPUS }, { timeout: 1 }); // $0.0042 ≥ cap
    expect(seen).toEqual(['warn', 'cap']);
    expect(meter.spent()).toBeCloseTo(3 * CALL, 10);
    const e = await claude.create({ model: OPUS }, { timeout: 1 }).catch((x) => x);
    expect(e).toBeInstanceOf(SpendCapError);
    expect(isSpendCapError(e)).toBe(true);
    expect(fake.calls).toHaveLength(3); // the refused call never reached the model
    fake.done();
    expect(spendNote('warn', meter)).toContain('80%');
    expect(spendNote('cap', meter)).toContain('00:00 UTC');
  });

  it('kept across a restart: the total, the notes already sent, and which rooms were told; a new UTC day starts at zero', () => {
    const file = join(tmp(), 'spend.json');
    const c = clock(Date.parse('2026-11-05T22:00:00Z'));
    const a = new SpendMeter({ file, cap: 1, now: c.now });
    expect(a.add(0.85)).toEqual(['warn']);
    expect(a.add(0.2)).toEqual(['cap']);
    expect(a.pausedNoticeDue('demo-room')).toBe(true);

    const b = new SpendMeter({ file, cap: 1, now: c.now }); // the restart
    expect(b.spent()).toBeCloseTo(1.05, 10);
    expect(b.capped()).toBe(true);
    expect(b.add(0.01)).toEqual([]); // no second 80% or cap note
    expect(b.pausedNoticeDue('demo-room')).toBe(false); // told once already
    expect(b.pausedNoticeDue('demo-room-2')).toBe(true);

    c.t = Date.parse('2026-11-06T00:00:01Z');
    expect(b.capped()).toBe(false);
    expect(b.spent()).toBe(0);
    const d = new SpendMeter({ file, cap: 1, now: c.now });
    expect(d.spent()).toBe(0);
    expect(d.add(0.9)).toEqual(['warn']); // a new day warns again
  });

  it('no cap: counts only, never refuses', async () => {
    const meter = new SpendMeter({ file: null, cap: null });
    meter.add(1000);
    expect(meter.capped()).toBe(false);
    expect(meter.add(1)).toEqual([]);
  });

  it('a capped decision posts nothing, sends no per-message owner note and does not retry', async () => {
    const { deps, traces } = setup('ck-cap-');
    const meter = new SpendMeter({ file: null, cap: 1 });
    meter.add(1.5);
    const fake = new FakeClaude([]);
    const poster = new FakePoster();
    let slept = 0;
    const results = await decideWithRetry(deps(meteredClaude(fake, meter) as FakeClaude, poster, { sleep: async () => { slept++; } }), 'room1', 'ck-test', ctx, [msg('m1', 'Could we do five agencies?')]);
    expect(results).toHaveLength(1);
    expect(results[0].retry).toBe(false);
    expect(slept).toBe(0);
    expect(fake.calls).toHaveLength(0);
    expect(poster.sent).toEqual([]);
    const [line] = traces();
    expect(line.kind).toBe('silence');
    expect(line.error).toContain('daily spend cap reached');
  });

  it('the cap reached between the verdict and the reviewer: nothing public, no owner note', async () => {
    const { deps, traces } = setup('ck-cap2-');
    const meter = new SpendMeter({ file: null, cap: CALL / 2 }); // the verdict call alone crosses it
    const fake = new FakeClaude([{ model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m1')], [{ blockId: 'led-012' }]) }]);
    const poster = new FakePoster();
    const r = await decide(deps(meteredClaude(fake, meter) as FakeClaude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'Could we take five agencies?')]);
    fake.done();
    expect(fake.calls.map((c) => c.model)).not.toContain(HAIKU);
    expect(poster.pub()).toEqual([]);
    expect(poster.desk()).toEqual([]);
    expect(r.retry).toBe(false);
    expect(traces()[0].error).toContain('reviewer_failed: daily spend cap reached'); // the reviewer was refused, not skipped
  });

  it('errorKind reads the cap as "paused", from the error or from the reviewer_failed text', () => {
    expect(errorKind(new SpendCapError(7, 6))).toBe('paused');
    expect(errorKind(`reviewer_failed: ${new SpendCapError(7, 6).message}`)).toBe('paused');
    expect(errorKind(Object.assign(new Error('boom'), { status: 500 }))).toBe('retryable');
  });
});

describe('the gate before a message is decided', () => {
  it('capped: a demo room is told once that the demo has paused; a Slack room stays silent', () => {
    const meter = new SpendMeter({ file: null, cap: 1 });
    meter.add(1);
    expect(gateMessage({ roomId: 'demo', demo: true, sender: ROWAN, meter })).toEqual({ go: false, say: PAUSED_LINE, why: 'spend_cap' });
    expect(gateMessage({ roomId: 'demo', demo: true, sender: SAM, meter })).toEqual({ go: false, say: null, why: 'spend_cap' });
    expect(gateMessage({ roomId: 'slack', demo: false, sender: ROWAN, meter })).toEqual({ go: false, say: null, why: 'spend_cap' });
  });

  it('under the cap: limits apply in demo rooms only, never in a Slack room', () => {
    const meter = new SpendMeter({ file: null, cap: 6 });
    const limiter = new DemoLimiter(cfg({ perPersonHour: 1 }), null, clock().now);
    limiter.noteReply('demo', ROWAN);
    limiter.noteReply('slack', ROWAN);
    expect(gateMessage({ roomId: 'demo', demo: true, sender: ROWAN, meter, limiter })).toEqual({ go: false, say: LIMIT_LINE, why: 'demo_limit' });
    expect(gateMessage({ roomId: 'demo', demo: true, sender: ROWAN, meter, limiter })).toEqual({ go: false, say: null, why: 'demo_limit' });
    expect(gateMessage({ roomId: 'slack', demo: false, sender: ROWAN, meter, limiter })).toEqual({ go: true });
    expect(gateMessage({ roomId: 'demo', demo: true, sender: KASH, owner: KASH, meter, limiter })).toEqual({ go: true });
  });
});
