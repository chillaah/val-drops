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

Requires Node 18+. There are no dependencies.

```sh
npm run build   # scrape the wiki into data/items.js and download images into img/
npm run serve   # http://localhost:8080
```

`node scripts/build-data.mjs --no-images` skips image downloads and uses wiki URLs instead.

## Project layout

```
index.html, app.js, styles.css   static site (no framework, no build step)
data/items.js                    generated item data (window.VAL_DROPS)
data/curated.json                hand-added items the wiki doesn't have yet
img/                             item images downloaded from the wiki
scripts/build-data.mjs           wiki scraper
scripts/notify-discord.mjs       posts new items to a Discord webhook
.github/workflows/               ci, update-data, deploy
```

### Adding a missing item

1. Add an entry to `data/curated.json` with `name`, `type`, `category`, `group`, `file` (the wiki image file name) and `refs` (official links).
2. Run `npm run build` and check the result locally.
3. Open a PR into `development`.

## License

The code is [MIT](LICENSE). Item data comes from the VALORANT Wiki under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).

This is a fan project and isn't affiliated with or endorsed by Riot Games. VALORANT and all related names, images and assets are trademarks or property of Riot Games, Inc.
