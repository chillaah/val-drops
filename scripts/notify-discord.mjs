// Posts newly added items, and items whose claim window opened since the last check,
// to a Discord channel via webhook.
//
// Usage: node scripts/notify-discord.mjs <old-items.js> <new-items.js> [--dry-run]
//        node scripts/notify-discord.mjs --item <slug> <items.js> [--dry-run]   post one item as now claimable
// Env:   DISCORD_WEBHOOK_URL (required unless --dry-run)
//        DISCORD_ADMIN_WEBHOOK_URL (optional) maintainer alerts, e.g. a co-streamer Drop
//                            with no channels listed; falls back to DISCORD_WEBHOOK_URL
//        PREV_CHECK          ISO time of the last successful check; without it no
//                            "now claimable" posts are sent
//        SITE_URL            (default: https://<owner>.github.io/<repo>/ from GITHUB_REPOSITORY)
//        RAW_BASE            (default: raw.githubusercontent.com/<repo>/<current commit>/)
//        FOLLOW=1            run for someone else's server (.github/workflows/discord-follow.yml):
//                            no maintainer alerts, a "set up" message instead of a summary on
//                            the first run, a lower flood limit, and nothing is posted if the
//                            item list shrank a lot (a broken publish, not real removals)
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const ITEM = args.includes("--item") ? args[args.indexOf("--item") + 1] : null;
const [oldPath, newPath = oldPath] = args.filter((a, k) => !a.startsWith("--") && args[k - 1] !== "--item");
const DRY_RUN = process.argv.includes("--dry-run");
const FOLLOW = process.env.FOLLOW === "1";
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const ADMIN_WEBHOOK = process.env.DISCORD_ADMIN_WEBHOOK_URL || WEBHOOK;
const PREV_CHECK = process.env.PREV_CHECK ? new Date(process.env.PREV_CHECK) : null;
const REPO = process.env.GITHUB_REPOSITORY || "chillaah/val-drops";
const [OWNER, NAME] = REPO.split("/");
const SITE_URL = process.env.SITE_URL || `https://${OWNER}.github.io/${NAME}/`;
// Image links point at this commit, not the branch: later runs convert or prune
// images, and Discord fetches embed images long after the post goes out.
const commit = () => { try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "production"; } };
const RAW_BASE = process.env.RAW_BASE || `https://raw.githubusercontent.com/${REPO}/${commit()}/`;

// More new items than this in one run usually means the scraper or the wiki
// layout changed, so post one summary instead of flooding the channel.
// Other people's servers get a lower limit.
const MAX_ITEMS = FOLLOW ? 10 : 25;
const COLOR = 0xff4655;

async function loadItems(file) {
  try {
    const src = await readFile(file, "utf8");
    return JSON.parse(src.replace(/^window\.VAL_DROPS\s*=\s*/, "").replace(/;\s*$/, "")).items;
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

// ids shift between builds and the wiki moves items between sections, so match
// on type + name (the same fallback build-data uses for firstSeen).
const key = (i) => i.type + "§" + i.name.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// Wiki dates are Pacific time. Only items claimable now or soon are worth a ping: an old
// item the wiki only just listed (often with no date at all) isn't news. Same rule as the
// site's "Recently added" list (status() in app.js).
// Event Drops carry the venue's time zone (period.tz), as on the site.
const dayIn = (d, tz = "America/Los_Angeles") => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
const NOW = new Date();
const PREV = PREV_CHECK && !isNaN(PREV_CHECK) ? PREV_CHECK : null;
// A window that started after the last check's day and is still open. Comparing with the
// last check, not "starts today", means a skipped or late run doesn't lose the post.
// Drops that end with an event's final have an exact time (period.endsAt) instead of a date.
const notEnded = (p, today) => (p.endsAt ? NOW < new Date(p.endsAt) : !p.end || p.end >= today);
const opened = (i) => {
  const p = i.period;
  if (!PREV || !p?.start) return false;
  const today = dayIn(NOW, p.tz);
  return p.start > dayIn(PREV, p.tz) && p.start <= today && notEnded(p, today);
};
const claimable = (i) => {
  const p = i.period;
  const today = dayIn(NOW, p?.tz);
  if (p?.end && notEnded(p, today) && (!p.start || p.start <= today)) return true;
  return Boolean(p?.start && p.start > today) || Boolean(i.ongoing);
};
// China-exclusive items can't be claimed on other servers.
const chinaOnly = (i) => i.regions?.some((r) => r.code === "CN");
// Dates from leaks or estimates aren't announced; wait for an official source before posting.
const unconfirmed = (i) => Boolean(i.unconfirmed);

// Co-streamer Drops can only be earned on certain channels, listed via data/curated.json.
const coStream = (i) => /co-?stream/i.test(i.subgroup || "");
const CHANNEL_URL = { twitch: (login) => `https://www.twitch.tv/${encodeURIComponent(login.toLowerCase())}` };

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function embed(item) {
  const where = [item.group, item.subgroup].filter(Boolean).join(" · ");
  const fields = (item.details[0] || []).slice(0, 3).map((d) => ({
    name: clip(d.label || "Details", 256),
    value: clip(d.value, 1024),
    inline: d.value.length < 40,
  }));
  const primary = item.sources.find((s) => s.official) || item.sources.find((s) => !s.wiki);
  if (item.channels) {
    const links = item.channels.logins.map((l) => `[${l}](${CHANNEL_URL[item.channels.platform](l)})`).join(", ");
    fields.push({ name: item.channels.partial ? "Channels include" : "Channels", value: clip(links, 1024) });
  }
  if (primary) fields.push({ name: "Source", value: `[${primary.label}](${primary.url})`, inline: true });
  const e = {
    title: clip(item.name, 256),
    url: item.slug ? `${SITE_URL}?item=${encodeURIComponent(item.slug)}` : `${SITE_URL}?q=${encodeURIComponent(item.name)}`,
    description: clip(`**${item.type}** · ${item.category}${where && where !== item.category ? `\n${where}` : ""}`, 4096),
    color: COLOR,
    fields,
    footer: { text: "Data: VALORANT Wiki" },
  };
  if (item.image) {
    const url = /^https?:/.test(item.image) ? item.image : RAW_BASE + item.image.split("/").map(encodeURIComponent).join("/");
    e.thumbnail = { url };
  }
  return e;
}

async function post(payload, webhook = WEBHOOK) {
  if (DRY_RUN) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return;
    if (res.status === 429) {
      const { retry_after = 1 } = await res.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, Math.ceil(retry_after * 1000) + 250));
      continue;
    }
    throw new Error(`Discord webhook failed: ${res.status} ${await res.text()}`);
  }
  throw new Error("Discord webhook kept rate-limiting; giving up.");
}

async function main() {
  if (!oldPath || !newPath) throw new Error("Usage: notify-discord.mjs <old-items.js> <new-items.js> [--dry-run]");
  if (!WEBHOOK && !DRY_RUN) {
    console.log("DISCORD_WEBHOOK_URL not set; skipping Discord notification.");
    return;
  }
  if (ITEM) {
    const item = (await loadItems(newPath)).find((i) => i.slug === ITEM);
    if (!item) throw new Error(`No item with slug ${ITEM}`);
    await postItems([item], "out-of-game reward now claimable");
    return;
  }
  const before = new Set((await loadItems(oldPath)).map(key));
  const items = await loadItems(newPath);
  if (FOLLOW && !before.size) {
    console.log(`First run: saved ${items.length} items. New ones will be posted from the next run.`);
    await post({
      username: "VAL Drops",
      content: `**VAL Drops alerts are set up for this channel.** New VALORANT rewards you can claim will be posted here.\nWhat's claimable now: <${SITE_URL}>`,
      allowed_mentions: { parse: [] },
    });
    return;
  }
  if (FOLLOW && items.length < before.size * 0.8) {
    throw new Error(`Item list shrank from ${before.size} to ${items.length}. That looks like a broken publish, so nothing was posted.`);
  }
  const fresh = items.filter((i) => !before.has(key(i)));
  const added = fresh.filter((i) => claimable(i) && !chinaOnly(i) && !unconfirmed(i));
  console.log(`${fresh.length} new item(s), ${added.length} worth posting.`);
  for (const i of fresh.filter((i) => !added.includes(i))) console.log(`  skipped (${chinaOnly(i) ? "China only" : unconfirmed(i) ? "unconfirmed date" : i.period?.end ? `ended ${i.period.end}` : "not claimable now or soon"}): ${i.name}`);
  // New items are posted as new, so don't post them twice.
  const opening = items.filter((i) => opened(i) && before.has(key(i)) && !chinaOnly(i) && !unconfirmed(i));
  console.log(PREV ? `${opening.length} item(s) claimable since ${PREV.toISOString()}.` : "PREV_CHECK not set; skipping now-claimable posts.");

  // On the first run there's nothing to compare with, so post one summary.
  await postItems(added, "new out-of-game reward", "new out-of-game rewards", !before.size);
  await postItems(opening, "out-of-game reward now claimable", "out-of-game rewards now claimable");

  if (FOLLOW) return; // the reminders below are for the maintainer only

  const missing = [...added, ...opening].filter((i) => coStream(i) && !i.channels && !(i.period?.start > dayIn(NOW, i.period?.tz)));
  if (missing.length) {
    await post({
      username: "VAL Drops",
      content: `**Co-streamer Drop${missing.length > 1 ? "s" : ""} live with no channels listed:** ${missing.map((i) => i.name).join(", ")}.\n` +
        "Copy the participating channels from <https://www.twitch.tv/drops/campaigns> (signed in) into `channels` in data/curated.json.",
      allowed_mentions: { parse: [] },
    }, ADMIN_WEBHOOK);
  }

  // Event Drops (those with a venue time zone) without exact times end at midnight there.
  const untimed = [...new Set([...added, ...opening].filter((i) => i.category === "Broadcast Drops" && i.period?.tz && !i.period.endsAt).map((i) => i.group))];
  if (untimed.length) {
    await post({
      username: "VAL Drops",
      content: `**Event Drops live without exact end times:** ${untimed.join(", ")}.\n` +
        "Add each event's valorantesports.com tournament id to `events` in data/curated.json.",
      allowed_mentions: { parse: [] },
    }, ADMIN_WEBHOOK);
  }
}

async function postItems(list, one, many, summary = false) {
  if (!list.length) return;
  if (summary || list.length > MAX_ITEMS) {
    await post({
      username: "VAL Drops",
      embeds: [{
        title: `${list.length} ${many}`,
        url: SITE_URL,
        description: "Too many changes to post one by one. Check the site for the full list.",
        color: COLOR,
      }],
    });
    return;
  }

  // Discord allows up to 10 embeds per message.
  for (let i = 0; i < list.length; i += 10) {
    const batch = list.slice(i, i + 10);
    await post({
      username: "VAL Drops",
      content: i === 0 ? `**${list.length} ${list.length > 1 ? many : one}** · <${SITE_URL}>` : undefined,
      embeds: batch.map(embed),
      allowed_mentions: { parse: [] },
    });
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
