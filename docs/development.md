# Development

[← Back to the README](../README.md)

## How it stays up to date

```
 every 6 hours      ┌───────────────────────┐   data-only commit   ┌────────────┐
 (cron) ──────────▶ │ update-data workflow  │ ───────────────────▶ │ production │ ──▶ GitHub Pages
                    │ scrape → check → save │                      └─────┬──────┘
                    └───────────────────────┘                            │ merged back
                                                                   ┌─────▼───────┐
                                                                   │ development │
                                                                   └─────────────┘
```

Each run:

1. Scrapes the wiki into `site/data/items.js` and saves any new images.
2. Checks the result. The scraper fails if a wiki page it reads suddenly yields no items (a renamed or restructured page), and `scripts/check-data.mjs` requires at least 200 items, no more than a 10% drop from the previous run, required fields and unique slugs. **If a wiki change breaks the scraper, the run fails and the live site keeps its last good data.**
   It also holds back the kinds of edit a wiki vandal would make: a changed code on an existing item, or a link to a site the data has never linked before. Check those on the wiki, then rerun **Update data** with **approve** ticked to publish them.
3. Commits to `production` only if something changed, which redeploys the site.
4. Posts new items, and items whose claim window opened since the last successful run, to Discord, then merges `production` back into `development`.

New rewards usually reach the wiki within hours of Riot announcing them. They appear on the site at the next run, or right away if you start **Update data** from the Actions tab.

## Quality

| | |
|---|---|
| **Performance** | Static HTML, CSS and JavaScript, with no framework and no runtime dependencies. Images are lossless WebP at display size, and fonts are self-hosted subsets. Layout shift on a cold load is close to zero. |
| **Accessibility** | Text meets WCAG AA contrast (4.5:1) in both themes. Cards and the item dialog work with the keyboard, and animations are off for people who prefer reduced motion. |
| **Without JavaScript** | `site/index.html` contains a pre-rendered list of every item, so search engines and visitors without JavaScript still get the full list. |
| **Privacy and security** | No analytics, cookies or third-party requests. A Content Security Policy allows only this site, plus wiki images as a fallback if a download failed. Workflows use least-privilege permissions and GitHub Actions pinned to commit SHAs, kept current by Dependabot. |
| **Sharing** | Open Graph and Twitter card tags, a 1200×630 preview image, `robots.txt`, `sitemap.xml` and structured data. |

## Requirements

- Node 18 or newer. There are no npm dependencies.
- Optional: the `webp` tools (`brew install webp` or `apt install webp`) to save images as WebP. Without them the build still works and keeps the wiki's PNG and GIF files.

## Commands

```sh
npm run build   # scrape the wiki into site/data/items.js, save images into site/img/, prerender site/index.html
npm run serve   # serve site/ at http://localhost:8080
```

`node scripts/build-data.mjs --no-images` skips image downloads and uses wiki image URLs instead. That's faster, and it's what CI runs.

## How images are stored

Thumbnails are requested from the wiki at display size (within 256×288) and saved as lossless WebP, so they look the same as the wiki's images at about a quarter of the size. The item view's 600px image (`*_600.webp`) and player-card banners (`*_Wide.webp`) are saved the same way and load only when an item is opened. Images that no item uses any more are deleted from `site/img/`.

## Project layout

```
site/                            everything that's published to GitHub Pages, and nothing else
  index.html, app.js, styles.css   the site (no framework, no build step)
  theme.js                         light/dark theme, loaded in <head> so there's no flash
  404.html                         not-found page (GitHub Pages serves it for any missing path)
  robots.txt, sitemap.xml          for search engines
  assets/                          favicon, touch icon, og.png preview image, no-JS stylesheet
  assets/fonts/                    self-hosted Geist and Geist Mono (SIL OFL, see OFL.txt)
  data/items.js                    generated item data (window.VAL_DROPS)
  data/items.json                  the same data as public JSON (see docs/data.md)
  data/curated.json                hand-added items the wiki doesn't have yet
  data/alerts.json                 pause switch for other servers' Discord alerts
  img/                             item images saved from the wiki
scripts/build-data.mjs           wiki scraper
scripts/export-json.mjs          writes site/data/items.json
scripts/check-data.mjs           blocks publishing if a scrape looks broken or an edit needs review
scripts/prerender.mjs            writes the plain item list into site/index.html
scripts/event-times.mjs          end times for event Drops from the official schedule
scripts/notify-discord.mjs       posts new items to a Discord webhook
scripts/og-image.html            source for site/assets/og.png (screenshot #og at 1200×630)
examples/discord-alerts.yml      workflow other servers copy to get Discord alerts
docs/                            these docs; images/ has the README screenshots and demo GIF
.github/workflows/               CI, data updates, deploys
```

## Adding a missing item

Not a developer? [Open an issue](https://github.com/chillaah/val-drops/issues/new/choose) with the item name and a link, and it'll be added.

1. Add an entry to [`site/data/curated.json`](../site/data/curated.json) with `name`, `type`, `category`, `group`, `file` (the wiki image file name) and `refs` (official links).
2. Run `npm run build` and check the result locally.
3. Open a pull request into `development`.

## Releases and workflows

| Branch | Purpose |
|---|---|
| `development` | Default branch. All work and pull requests go here. |
| `production` | The live site. Every push deploys to GitHub Pages. The data bot commits new items here and merges them back into `development`. |

**To release,** open a pull request from `development` into `production` and merge it.

| Workflow | Runs | What it does |
|---|---|---|
| [CI](../.github/workflows/ci.yml) | Pushes to `development`, pull requests | Syntax-checks the scripts, runs the scraper and the data check, and confirms the site files exist. Commits nothing. |
| [Update data](../.github/workflows/update-data.yml) | Every 6 hours, or manually | Scrapes, checks and commits new data to `production`, posts to Discord, merges back into `development`. Run it manually with **approve** to publish changes the check held for review. |
| [Deploy](../.github/workflows/deploy.yml) | Pushes to `production`, or manually | Publishes the site to GitHub Pages. |
| [Discord test](../.github/workflows/discord-test.yml) | Manually | Shows which channel the webhook posts to and can send one test message. |
| [Discord alerts for other servers](../.github/workflows/discord-follow.yml) | Called from other people's repos | Posts new items from the live `data/items.json` to their own Discord channel. See [Get alerts in your Discord server](discord-alerts.md). |

## Discord notifications

When the update job finds new items, or an item's claim window has opened since the last successful run (like a Drop that starts on a set day), it posts each one to a Discord channel with its image, dates or how to get it, primary source, and a link to the item on the site. Only items claimable now or soon are posted (the same rule as the "New" badge), so old or undated items the wiki only just listed, China-only items and items with an unconfirmed date are left out, and an item the wiki only moved to another section doesn't count as new. Image links point at the exact commit, so they keep working after later runs convert or prune images.

1. In Discord, open **Server Settings → Integrations → Webhooks → New Webhook**, pick the channel and copy the webhook URL.
2. In this repo, add it under **Settings → Secrets and variables → Actions** as `DISCORD_WEBHOOK_URL`.
3. Optional: run the **Discord test** workflow to confirm the channel.

When a co-streamer Drop goes live with no channels listed, or an event's Drops go live with no `events` line for exact end times, a reminder is posted too. Set `DISCORD_ADMIN_WEBHOOK_URL` to send those reminders to a separate (private) channel; without it they go to the main one.

If the secret isn't set, the step is skipped. A run with more than 25 new items posts one summary message instead of flooding the channel. To preview messages without posting, run `PREV_CHECK=<ISO time> node scripts/notify-discord.mjs <old-items.js> site/data/items.js --dry-run`.
