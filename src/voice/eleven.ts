// eleven: a small ElevenLabs REST client (fetch, no SDK: the shared node_modules has no
// @elevenlabs/elevenlabs-js and package.json belongs to the foundation lane). Behind an interface
// so offline tests swap in a fake. The key is read from ELEVENLABS_API_KEY and never printed or logged.
export const EL_BASE = 'https://api.elevenlabs.io';

export interface ElevenResponse { status: number; headers: Headers; bytes: Buffer; json: () => any }

export interface Eleven {
  /** JSON in, JSON out (or bytes for audio). Throws ElevenError on a non-2xx. */
  request(method: string, path: string, body?: unknown, opts?: { timeoutMs?: number }): Promise<ElevenResponse>;
}

export class ElevenError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly requestId: string | null) {
    super(message);
    this.name = 'ElevenError';
  }
}

/** 401/402/403: audio off for the session (bad key, no credit, missing scope). Anything else: this one fails. */
export const fatalEleven = (e: unknown): boolean => e instanceof ElevenError && [401, 402, 403].includes(e.status);

export function realEleven(apiKey = process.env.ELEVENLABS_API_KEY ?? ''): Eleven {
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set (audio stays off; the text brief still goes out)');
  return {
    async request(method, path, body, opts = {}) {
      const res = await fetch(`${EL_BASE}${path}`, {
        method,
        headers: { 'xi-api-key': apiKey, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
      const bytes = Buffer.from(await res.arrayBuffer());
      const json = () => JSON.parse(bytes.toString('utf8') || 'null');
      if (!res.ok) {
        let code = 'http_error';
        let msg = bytes.toString('utf8').slice(0, 300);
        try {
          const d = json()?.detail;
          if (d && typeof d === 'object' && !Array.isArray(d)) { code = d.code ?? d.status ?? code; msg = d.message ?? msg; }
        } catch { /* keep raw text */ }
        throw new ElevenError(res.status, String(code), `ElevenLabs ${method} ${path.split('?')[0]}: ${res.status} ${msg}`, res.headers.get('request-id'));
      }
      return { status: res.status, headers: res.headers, bytes, json };
    },
  };
}
