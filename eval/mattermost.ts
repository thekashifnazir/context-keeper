// mattermost: the eval's personas talk to Mattermost's REST API directly, as real users who signed
// themselves up (open sign-up, no admin secret), the way Switch's own e2e harness does.
// Never the admin account (the bridge drops its posts), never a name equal to an agent's.

export interface MmUser { id: string; username: string }
export interface MmChannel { id: string; name: string; display_name: string; type: string; team_id: string }
export interface MmRawPost { id: string; channel_id: string; user_id: string; root_id: string; message: string; type: string; create_at: number; delete_at?: number }

export class Mattermost {
  constructor(readonly url: string, private token: string | null = null) {}

  private async req<T>(method: string, path: string, body?: unknown, okStatuses = [200, 201]): Promise<{ status: number; data: T; headers: Headers }> {
    const res = await fetch(`${this.url}/api/v4${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    const data = (text ? JSON.parse(text) : null) as T;
    if (!okStatuses.includes(res.status)) {
      const msg = (data as { message?: string } | null)?.message ?? text.slice(0, 200);
      throw new Error(`Mattermost ${method} ${path}: ${res.status} ${msg}`);
    }
    return { status: res.status, data, headers: res.headers };
  }

  async ping(): Promise<string | null> {
    const res = await fetch(`${this.url}/api/v4/system/ping`, { signal: AbortSignal.timeout(5000) });
    return res.ok ? res.headers.get('x-version-id') : null;
  }

  /** Sign up (no auth; open server) or, if the account exists, just sign in. Returns a client holding the session. */
  static async persona(url: string, username: string, password: string, firstName: string): Promise<{ mm: Mattermost; user: MmUser; created: boolean }> {
    const anon = new Mattermost(url);
    const made = await anon.req<MmUser>('POST', '/users', { username, password, email: `${username}@ck-eval.local`, first_name: firstName }, [201, 400]);
    const res = await anon.req<MmUser>('POST', '/users/login', { login_id: username, password });
    const token = res.headers.get('token');
    if (!token) throw new Error(`Mattermost sign-in for ${username} gave no token`);
    return { mm: new Mattermost(url, token), user: res.data, created: made.status === 201 };
  }

  async teamByName(name: string) { return (await this.req<{ id: string }>('GET', `/teams/name/${name}`)).data; }
  async joinTeam(teamId: string, userId: string) { await this.req('POST', `/teams/${teamId}/members`, { team_id: teamId, user_id: userId }); }
  async channelByName(teamId: string, name: string): Promise<MmChannel | null> {
    const r = await this.req<MmChannel>('GET', `/teams/${teamId}/channels/name/${name}?include_deleted=true`, undefined, [200, 403, 404]);
    return r.status === 200 ? r.data : null;
  }
  async searchChannels(teamId: string, term: string): Promise<MmChannel[]> {
    return (await this.req<MmChannel[]>('POST', `/teams/${teamId}/channels/search`, { term })).data;
  }
  async myChannels(teamId: string): Promise<MmChannel[]> {
    return (await this.req<MmChannel[]>('GET', ['', 'users', 'me', 'teams', teamId, 'channels'].join('/'))).data;
  }
  async joinChannel(channelId: string, userId: string) { await this.req('POST', `/channels/${channelId}/members`, { user_id: userId }); }
  async userByUsername(username: string): Promise<MmUser | null> {
    const r = await this.req<MmUser>('GET', ['', 'users', 'username', username].join('/'), undefined, [200, 404]);
    return r.status === 200 ? r.data : null;
  }
  async post(channelId: string, message: string, rootId = ''): Promise<MmRawPost> {
    return (await this.req<MmRawPost>('POST', '/posts', { channel_id: channelId, message, root_id: rootId })).data;
  }
  /** Every post in a channel (threads included) created or edited since `sinceMs`, oldest first.
   *  Uses `since=`, as Switch's own e2e harness does: the paged listing (page=&per_page=) crashed the
   *  amd64 Mattermost image under qemu emulation on an arm64 Mac (SIGSEGV in getPostsForChannel). */
  async allPosts(channelId: string, sinceMs = 1): Promise<MmRawPost[]> {
    const r = (await this.req<{ order: string[]; posts: Record<string, MmRawPost> }>('GET', `/channels/${channelId}/posts?since=${sinceMs}`)).data;
    return Object.values(r.posts ?? {}).sort((a, b) => a.create_at - b.create_at || (a.id < b.id ? -1 : 1));
  }
}
