// names: turn the handle Switch gives us (sender_name, e.g. "rowan_demo") into the name people
// see in the chat ("Rowan"). Slack: users.list with the bot token. Discord: a member search in
// the bot's servers. Results are cached; any failure falls back to the handle, never throws.

type Platform = 'slack' | 'discord' | 'other';
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { name: string; at: number }>();
let slackLoadedAt = 0;
let discordGuilds: string[] | null = null;

export function platformOf(sender: string): Platform {
  if (sender.includes('switch-slack-')) return 'slack';
  if (sender.includes('switch-discord-')) return 'discord';
  return 'other';
}

async function loadSlack(token: string) {
  let cursor = '';
  do {
    const res = await fetch(`https://slack.com/api/users.list?limit=200${cursor ? `&cursor=${cursor}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = (await res.json()) as {
      ok: boolean;
      members?: { name: string; deleted?: boolean; profile: { display_name?: string; real_name?: string } }[];
      response_metadata?: { next_cursor?: string };
    };
    if (!d.ok) return;
    for (const u of d.members ?? []) {
      if (u.deleted) continue;
      const shown = u.profile.display_name || u.profile.real_name;
      if (shown) cache.set(`slack:${u.name}`, { name: shown, at: Date.now() });
    }
    cursor = d.response_metadata?.next_cursor ?? '';
  } while (cursor);
  slackLoadedAt = Date.now();
}

async function lookupDiscord(token: string, handle: string): Promise<string | null> {
  const auth = { Authorization: `Bot ${token}` };
  discordGuilds ??= ((await (await fetch('https://discord.com/api/v10/users/@me/guilds', { headers: auth })).json()) as { id: string }[]).map((g) => g.id);
  for (const g of discordGuilds) {
    const res = await fetch(`https://discord.com/api/v10/guilds/${g}/members/search?limit=5&query=${encodeURIComponent(handle)}`, { headers: auth });
    if (!res.ok) continue;
    const members = (await res.json()) as { nick?: string | null; user: { username: string; global_name?: string | null } }[];
    const m = members.find((x) => x.user.username === handle);
    if (m) return m.nick || m.user.global_name || null;
  }
  return null;
}

/** The name people see in the chat for this sender, or the handle if it can't be found. */
export async function displayName(sender: string, handle: string): Promise<string> {
  const platform = platformOf(sender);
  const key = `${platform}:${handle}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.name;
  try {
    if (platform === 'slack' && process.env.SLACK_BOT_TOKEN) {
      if (Date.now() - slackLoadedAt > 30_000) await loadSlack(process.env.SLACK_BOT_TOKEN);
      return cache.get(key)?.name ?? handle;
    }
    if (platform === 'discord' && process.env.DISCORD_BOT_TOKEN) {
      const name = await lookupDiscord(process.env.DISCORD_BOT_TOKEN, handle);
      if (name) {
        cache.set(key, { name, at: Date.now() });
        return name;
      }
    }
  } catch {
    // fall through to the handle
  }
  return handle;
}
