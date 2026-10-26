// Posts newly added items to a Discord channel via webhook.
//
// Usage: node scripts/notify-discord.mjs <old-items.js> <new-items.js> [--dry-run]
// Env:   DISCORD_WEBHOOK_URL (required unless --dry-run)
//        SITE_URL            (default: https://<owner>.github.io/<repo>/ from GITHUB_REPOSITORY)
//        RAW_BASE            (default: raw.githubusercontent.com/<repo>/<current commit>/)
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const [oldPath, newPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DRY_RUN = process.argv.includes("--dry-run");
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const REPO = process.env.GITHUB_REPOSITORY || "chillaah/val-drops";
const [OWNER, NAME] = REPO.split("/");
const SITE_URL = process.env.SITE_URL || `https://${OWNER}.github.io/${NAME}/`;
// Image links point at this commit, not the branch: later runs convert or prune
// images, and Discord fetches embed images long after the post goes out.
const commit = () => { try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "production"; } };
const RAW_BASE = process.env.RAW_BASE || `https://raw.githubusercontent.com/${REPO}/${commit()}/`;

// More new items than this in one run usually means the scraper or the wiki
// layout changed, so post one summary instead of flooding the channel.
const MAX_ITEMS = 25;
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

// Wiki dates are Pacific time. Items whose claim window has closed aren't worth a ping.
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const ended = (i) => !i.ongoing && i.period?.end && i.period.end < TODAY;
// China-exclusive items can't be claimed on other servers.
const chinaOnly = (i) => i.regions?.some((r) => r.code === "CN");

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function embed(item) {
  const where = [item.group, item.subgroup].filter(Boolean).join(" · ");
  const fields = (item.details[0] || []).slice(0, 3).map((d) => ({
    name: clip(d.label || "Details", 256),
    value: clip(d.value, 1024),
    inline: d.value.length < 40,
  }));
  const primary = item.sources.find((s) => s.official) || item.sources.find((s) => !s.wiki);
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

async function post(payload) {
  if (DRY_RUN) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(WEBHOOK, {
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
  const before = new Set((await loadItems(oldPath)).map(key));
  const fresh = (await loadItems(newPath)).filter((i) => !before.has(key(i)));
  const added = fresh.filter((i) => !ended(i) && !chinaOnly(i));
  console.log(`${fresh.length} new item(s), ${added.length} worth posting.`);
  for (const i of fresh.filter((i) => !added.includes(i))) console.log(`  skipped (${chinaOnly(i) ? "China only" : `ended ${i.period.end}`}): ${i.name}`);
  if (!added.length) return;

  if (!before.size || added.length > MAX_ITEMS) {
    await post({
      username: "VAL Drops",
      embeds: [{
        title: `${added.length} items added`,
        url: SITE_URL,
        description: "Too many changes to post one by one. Check the site for the full list.",
        color: COLOR,
      }],
    });
    return;
  }

  // Discord allows up to 10 embeds per message.
  for (let i = 0; i < added.length; i += 10) {
    const batch = added.slice(i, i + 10);
    await post({
      username: "VAL Drops",
      content: i === 0 ? `**${added.length} new out-of-game reward${added.length > 1 ? "s" : ""}** · <${SITE_URL}>` : undefined,
      embeds: batch.map(embed),
      allowed_mentions: { parse: [] },
    });
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
