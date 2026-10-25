<div align="center">

# VALORANT Out-of-Game Rewards

**Every VALORANT cosmetic you can't buy in the store or unlock from a battle pass, all on one page.**

Broadcast drops · Pick'Ems · Conflict events · Brand partnerships · Code redemptions · Prime Gaming · PS+ · Pro play

[![Deploy](https://github.com/chillaah/val-drops/actions/workflows/deploy.yml/badge.svg?branch=production)](https://github.com/chillaah/val-drops/actions/workflows/deploy.yml)
[![Update data](https://github.com/chillaah/val-drops/actions/workflows/update-data.yml/badge.svg)](https://github.com/chillaah/val-drops/actions/workflows/update-data.yml)
[![CI](https://github.com/chillaah/val-drops/actions/workflows/ci.yml/badge.svg?branch=development)](https://github.com/chillaah/val-drops/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)

**[chillaah.github.io/val-drops](https://chillaah.github.io/val-drops/)**

</div>

---

## What's in it

Every **title, player card, gun buddy, spray and gun skin** earned outside the game's usual store, battle pass and agent progression. Each item has an image, how and when it was obtained, and links to its sources.

| Section | Examples |
|---|---|
| **Broadcast Drops** | VCT Masters, Champions and Game Changers Twitch drops, co-streamer titles, Shotcall extension rewards, Red Bull Home Ground, Arcane premieres |
| **Pick'Ems** | Top 50% / top 20% buddies, Pick'Ems sprays, participation and perfect-picks titles |
| **Events & Partnerships** | Alpha vs. Omega Conflict, Champions Conflict: Frag or Die, Coinbase, ExpressVPN, Verizon, Xbox Game Pass, merch figure codes, watch parties, RiotX Arcane |
| **Code Redemption** | Public codes from Riot (Pride cards, community challenges) |
| **Prime Gaming** | Monthly Prime Gaming drops from 2020 to 2024, including the Wayfinder Shorty skin |
| **PlayStation Plus** | Rotating PS+ member bundles |
| **Pro Play** | Tournament winner buddies and titles given to pros |

You can search and filter by source and by item type. The site also works on mobile.

- **Claimable now:** rewards you can still get, each with a countdown and a "how to claim" line, plus what's coming soon.
- **Recently added:** items that appeared on the site in the last 30 days. The build script records the date each item was first seen.
- **One card per item:** items you can get in more than one way (like Slime Mosh, a Twitch drop and a Coinbase reward) appear once, with an "Also from" list.
- **Item pages:** click any card for a detail view with a larger image (plus the wide banner for player cards) and a shareable link such as `?item=slime-mosh-buddy`. Discord posts link straight to these.
- **Codes:** each public redemption code has a Copy button. Expired codes, and codes for Riot's old redemption site, are struck through and marked expired.
- **Region filter:** items with a stated restriction are tagged and filterable: South Korea only, Japan only, in person only, or not available in some countries. Tags only come from what the source says.
- **Newest first:** a month-by-month timeline view, which you can link to with `?sort=newest`.

## Sources and accuracy

- Item data and images come from the **[VALORANT Wiki](https://wiki.playvalorant.com/en-us/)** through its MediaWiki API. The wiki is community-edited and run by Weird Gloop. **Riot doesn't run it.**
- Each item also links to the **primary source** the wiki cites for it, where there is one: VALORANT Esports articles, PlayVALORANT news, Riot Support, official Riot/VCT social posts, or the partner's campaign page. Riot-owned links are marked ✓.
- [`data/curated.json`](data/curated.json) holds items the wiki doesn't list yet, such as the ExpressVPN × VCT rewards. Every entry there must cite an official page.

## How it stays up to date

```
 every 6h          ┌──────────────────────┐   data-only commit   ┌────────────┐
 (cron) ─────────▶ │ update-data workflow │ ───────────────────▶ │ production │ ──▶ GitHub Pages
                   │ scrape VALORANT Wiki │                      └─────┬──────┘
                   └──────────────────────┘                            │ merged back
                                                                 ┌─────▼──────┐
                                                                 │ development│
                                                                 └────────────┘
```

Before anything is committed, `scripts/check-data.mjs` checks the new data: at least 200 items, no more than a 10% drop from the last run, required fields present and slugs unique. If a wiki layout change breaks the scraper, the run fails and the live site keeps its last good data.

New rewards usually reach the wiki within hours of Riot announcing them. They show up on the site at the next scheduled run, or right away if you start **Update data** from the Actions tab.

### Discord notifications

When the update job finds new items, it posts them to a Discord channel with each item's image, dates or acquisition method, primary source, and a link to the item on the site. Setup:

1. In Discord, open **Server Settings → Integrations → Webhooks → New Webhook**, pick the channel and copy the webhook URL.
2. In this repo, add it under **Settings → Secrets and variables → Actions** as `DISCORD_WEBHOOK_URL`.

If the secret isn't set, the step is skipped. A single run with more than 25 new items posts one summary message instead of flooding the channel. To preview the messages without posting anything, run `node scripts/notify-discord.mjs <old-items.js> data/items.js --dry-run`.

## Branches

| Branch | Purpose |
|---|---|
| `development` | Default branch. All work and pull requests go here. CI checks that the scraper still parses the wiki. |
| `production` | The live site. Every push deploys to GitHub Pages. The data bot commits new items here and merges them back into `development`. |

To release, open a PR from `development` into `production` and merge it.

## Running locally

Requires Node 18+. There are no npm dependencies. Install `webp` (`brew install webp` or `apt install webp`) to save images as WebP. Without it the build still works and keeps the wiki's PNG and GIF files.

```sh
npm run build   # scrape the wiki into data/items.js, save images into img/, prerender index.html
npm run serve   # http://localhost:8080
```

`node scripts/build-data.mjs --no-images` skips image downloads and uses wiki URLs instead.

Thumbnails are requested from the wiki at display size (within 256×288) and stored as lossless WebP, so they look the same as the wiki's images at about a quarter of the size. Images no item uses any more are deleted from `img/`.

## Project layout

```
index.html, app.js, styles.css   static site (no framework, no build step)
404.html                         not-found page (GitHub Pages serves it for any missing path)
robots.txt, sitemap.xml          for search engines
assets/                          favicon, touch icon and og.png social preview
data/items.js                    generated item data (window.VAL_DROPS)
data/curated.json                hand-added items the wiki doesn't have yet
img/                             item images downloaded from the wiki
scripts/build-data.mjs           wiki scraper
scripts/notify-discord.mjs       posts new items to a Discord webhook
scripts/check-data.mjs           blocks publishing if a scrape looks broken
scripts/prerender.mjs            writes a plain item list into index.html for search engines and no-JS visitors
scripts/og-image.html            source for assets/og.png (screenshot #og at 1200×630)
.github/workflows/               ci, update-data, deploy
```

### Adding a missing item

1. Add an entry to `data/curated.json` with `name`, `type`, `category`, `group`, `file` (the wiki image file name) and `refs` (official links).
2. Run `npm run build` and check the result locally.
3. Open a PR into `development`.

## License

The code is [MIT](LICENSE). Item data comes from the VALORANT Wiki under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).

This is a fan project and isn't affiliated with or endorsed by Riot Games. VALORANT and all related names, images and assets are trademarks or property of Riot Games, Inc.
