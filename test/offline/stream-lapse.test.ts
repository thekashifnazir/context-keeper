// The vendored runtime against a fake socket, for the 4 Nov silent drop: Switch evicts the
// connection with heartbeat_lapsed and closes the socket. The runtime must report the eviction
// (recoverable), report the close with its code and reason, reopen from its position, and count
// every ping as a sign of life (onAlive, which the watchdog reads). Aborting the caller's signal
// closes the open socket, so a stream the watchdog replaces doesn't linger.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SwitchEventStream } from '../../vendor/switch-agent-runtime/src/index.ts';
import { EVICTION_HEARTBEAT_LAPSED, type Eviction } from '../../vendor/switch-agent-runtime/src/event-stream.ts';

type Listener = (ev: any) => void;
class FakeSocket {
  static all: FakeSocket[] = [];
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readyState = 0;
  sent: any[] = [];
  closedWith: number | null = null;
  private ls = new Map<string, Listener[]>();
  constructor(readonly url: string) { FakeSocket.all.push(this); }
  addEventListener(type: string, fn: Listener) { this.ls.set(type, [...(this.ls.get(type) ?? []), fn]); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close(code = 1000) { if (this.readyState > 1) return; this.closedWith = code; this.serverClose(code, ''); }
  private fire(type: string, ev: any) { for (const fn of this.ls.get(type) ?? []) fn(ev); }
  // server side
  open() { this.readyState = 1; this.fire('open', {}); }
  frame(event: string, data: Record<string, unknown>, id?: number) { this.fire('message', { data: JSON.stringify({ event, data, ...(id ? { id } : {}) }) }); }
  serverClose(code: number, reason: string) { this.readyState = 3; this.fire('close', { code, reason }); }
  get params() { return new URL(this.url).searchParams; }
}

const realWs = (globalThis as any).WebSocket;
beforeEach(() => { FakeSocket.all = []; (globalThis as any).WebSocket = FakeSocket; });
afterEach(() => { (globalThis as any).WebSocket = realWs; });

const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(cond: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); }
}

describe('vendored event stream: heartbeat_lapsed', () => {
  it('reports the eviction and the close, then reopens from its position; pings count as alive', async () => {
    const ac = new AbortController();
    const seen = { alive: 0, connected: 0, events: [] as string[], evicted: [] as Eviction[], disconnected: [] as string[] };
    const s = new SwitchEventStream({
      creds: { agentId: 'a1', apiEndpoint: 'http://switch.test', token: 't' },
      connectionId: 'c1', scope: 'all', filter: 'all', rooms: ['room1'],
      startPosition: { s: 4, 'r:room1': 2 },
      onAlive: () => { seen.alive += 1; },
      onEvent: (ev) => { seen.events.push((ev.payload as any).message_id); },
      onConnected: () => { seen.connected += 1; },
      onDisconnected: ({ error }) => { seen.disconnected.push(error); },
      onGap: () => {},
      onEvicted: (e) => { seen.evicted.push(e); },
      log: { debug: () => {}, warn: () => {}, error: () => {} },
      signal: ac.signal,
    });
    s.start();
    await until(() => FakeSocket.all.length === 1);
    const w1 = FakeSocket.all[0];
    expect(JSON.parse(w1.params.get('start_at')!)).toEqual({ s: 4, 'r:room1': 2 });
    expect(w1.params.get('rooms')).toBe('room1');
    w1.open();
    w1.frame('connection_state', { generation: 7, position: { s: 4, 'r:room1': 2 }, rooms: ['room1'] });
    await until(() => seen.connected === 1);
    w1.frame('ping', {});
    expect(w1.sent.at(-1)).toMatchObject({ type: 'pong', position: { s: 4, 'r:room1': 2 } });
    w1.frame('message', { type: 'message', room_id: 'room1', payload: { message_id: 'm5' }, position: { 'r:room1': 3 } }, 5);
    await until(() => seen.events.length === 1);
    const aliveBefore = seen.alive;
    expect(aliveBefore).toBeGreaterThanOrEqual(3); // connection_state, ping, message

    // Switch: no pong for 6 s → evicted heartbeat_lapsed, then it closes the socket.
    w1.frame('evicted', { code: 'heartbeat_lapsed', reason: 'heartbeat lapsed' });
    await tick();
    w1.serverClose(1000, 'heartbeat lapsed');
    await until(() => seen.disconnected.length === 1);
    expect(seen.evicted).toEqual([{ code: EVICTION_HEARTBEAT_LAPSED, reason: 'heartbeat lapsed', roomId: null }]);
    expect(seen.disconnected[0]).toBe('the server closed the stream (code 1000: heartbeat lapsed)');

    // The runtime reopens by itself (first backoff 1 s), claiming its incarnation, from its position.
    await until(() => FakeSocket.all.length === 2);
    const w2 = FakeSocket.all[1];
    expect(w2.params.get('expected_generation')).toBe('7');
    expect(JSON.parse(w2.params.get('start_at')!)).toEqual({ s: 4, 'r:room1': 3 });
    w2.open();
    w2.frame('connection_state', { generation: 8, position: { s: 4, 'r:room1': 3 }, rooms: ['room1'] });
    await until(() => seen.connected === 2);
    expect(seen.alive).toBeGreaterThan(aliveBefore);

    // Stopping the stream (the watchdog's stop) closes its socket and it does not reopen.
    ac.abort();
    expect(w2.closedWith).toBe(1000);
    await new Promise((r) => setTimeout(r, 1200));
    expect(FakeSocket.all).toHaveLength(2);
  }, 10_000);
});
