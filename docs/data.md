# Features, data and sources

[← Back to the README](../README.md)

## Features in detail

- **Claimable now.** Rewards you can still get, free ones first, then those that need a subscription or purchase (PS Plus, Prime Gaming, a partner offer), each with a countdown and a "how to claim" line. Public codes that may still work and upcoming rewards are listed too.
- **Next drop.** When a reward window is scheduled, a countdown to it sits above Claimable now.
- **Search and filters.** Search names, events, partners and codes. Filter by source, item type and region.
- **Item pages.** Click any card for a larger image (plus the wide banner for player cards) and a shareable link such as [`?item=slime-mosh-buddy`](https://chillaah.github.io/val-drops/?item=slime-mosh-buddy).
- **Redemption codes.** Every public code has a Copy button. Expired codes, and codes for Riot's old redemption site, are struck through.
- **Region tags.** Items with a stated restriction (South Korea only, Japan only, China only, in person only, not available in some countries) are tagged. Tags only come from what the source says.
- **One card per item.** An item you can get in several ways, like Slime Mosh (a Twitch drop and a Coinbase reward), appears once with an "Also from" list.
- **New badges and timeline.** Items first seen in the last 30 days that can be claimed now or soon get a "New" badge (old items the wiki only just listed don't count), and [`?sort=newest`](https://chillaah.github.io/val-drops/?sort=newest) shows everything month by month.
- **Light and dark themes.** Follows your system setting until you pick one with the toggle in the header.
- **Discord alerts.** New items, and items whose claim window just opened, can be posted to a Discord channel automatically ([setup](development.md#discord-notifications)). Other servers can get the same alerts with one small workflow file ([how](discord-alerts.md)).
- **Event end times.** Drops that end with an event's final go offline a couple of hours after it, not at midnight. The build reads the grand final's scheduled start from the [official schedule](https://valorantesports.com) and sets the end to that + a full best-of-five (about 6¼ hours) + 2 hours for co-streamers. Each event needs one line in `events` in [`data/curated.json`](../data/curated.json) with its tournament id. Without that line, or if the page can't be read, Drops from an event end at midnight in the host city. (vlr.gg has actual map times, but its terms forbid scripted access.)
- **Co-streamer channels.** For co-streamer Drops, "How to claim" links the participating Twitch channels, copied by hand into `channels` in [`data/curated.json`](../data/curated.json) from Twitch's Drops page (Twitch has no public API for them).

## What's tracked

Every **title, player card, gun buddy, spray and gun skin** earned outside the game's usual store, battle pass and agent progression.

| Source | Examples |
|---|---|
| **Broadcast Drops** | VCT Masters, Champions and Game Changers Twitch and Kick drops, co-streamer titles, Shotcall extension rewards, Red Bull Home Ground, Arcane premieres |
| **Pick'Ems** | Per tournament: participation title or spray, top 50% and top 20% buddies with the points needed, pick windows, and the 100% Title |
| **Events & Partnerships** | Challenge events on Riot's FTW site (Alpha vs. Omega, Frag or Die, Night Queue, MAHASONGKRAN), Coinbase, ExpressVPN, Verizon, Xbox Game Pass, merch figure codes, watch parties, RiotX Arcane |
| **Code Redemption** | Public codes from Riot (Pride cards, community challenges) |
| **Prime Gaming** | Monthly Prime Gaming drops from 2020 to 2024, including the Wayfinder Shorty skin |
| **PlayStation Plus** | Rotating PS+ member bundles, dated by month from each bundle's start until the next one |
| **Pro Play** | Tournament winner buddies and titles given to pros, tagged "Pro players only" |
| **Closed Beta** | The 2020 Closed Beta reward pass, entered through Twitch drops (items removed at launch are left out) |
| **China Exclusive** | Items only obtainable on the China version of VALORANT, tagged "China only" and not posted to Discord |

## Public JSON

All items are published as JSON, updated with the site:

**https://chillaah.github.io/val-drops/data/items.json**

Use it for Discord bots, trackers, spreadsheets or anything else. No key, no rate limit beyond GitHub Pages' own. Please credit the VALORANT Wiki and link back to this site (the text is CC BY-SA 3.0, see `license` in the file).

```jsonc
{
  "schemaVersion": 1,          // bumped only if a field is renamed or removed
  "generated": "2026-11-25T15:36:00.914Z",
  "count": 289,                // number of items in this file
  "items": [
    {
      "slug": "slime-mosh-buddy",            // stable id, also the site link: ?item=<slug>
      "url": "https://chillaah.github.io/val-drops/?item=slime-mosh-buddy",
      "name": "Slime Mosh Buddy",
      "type": "Gun Buddy",                   // Title, Player Card, Gun Buddy, Spray, Gun Skin
      "category": "Broadcast Drops",         // where it came from (see "What's tracked")
      "group": "...",                        // event or campaign
      "image": "https://...webp",            // full URLs; imageLarge and imageWide when available
      "period": { "start": "2026-07-24", "end": "2026-07-24" },  // plus "tz" and "endsAt" for some events
      "codes": [{ "code": "...", "expires": "2023-12-31", "defunct": false }],
      "regions": [],                         // stated restrictions, e.g. "South Korea only"
      "sources": [{ "url": "...", "label": "...", "official": true }],
      "alsoFrom": [],                        // other ways to get the same item
      "firstSeen": "2026-10-28"              // when the site first listed it (null for the first build)
    }
  ]
}
```

Fields can be `null` when the source doesn't say. New fields may be added at any time without a version bump.

## Sources and accuracy

- Item data and images come from the **[VALORANT Wiki](https://wiki.playvalorant.com/en-us/)** through its MediaWiki API. The wiki is community-edited and run by Weird Gloop. **Riot doesn't run it.**
- Each item also links to the **primary source** the wiki cites for it, where there is one: VALORANT Esports articles, PlayVALORANT news, Riot Support, official Riot/VCT social posts, or the partner's campaign page. Riot-owned links are marked ✓, matched on the whole hostname so a look-alike domain can't get the mark.
- [`data/curated.json`](../data/curated.json) holds items the wiki doesn't list yet, such as the ExpressVPN × VCT rewards. Every entry there must cite an official page. Its `dates` list fills in claim windows the wiki leaves out. A date that comes from leaks, game files or an estimate gets an `unconfirmed` reason: the item shows an "Unconfirmed date" badge with that reason, and gets no "New" badge and stays out of the Discord alerts. Comments and replies are never used as a source.
- Claim dates follow the wiki and are in Pacific time. The site says so next to them and links the source to check. Notes the wiki keeps in tooltips, such as a claim window that was cut short, are shown next to the dates.

**Wiki pages read:** [Broadcast Rewards](https://wiki.playvalorant.com/en-us/Broadcast_Rewards), [Prime Gaming Drops](https://wiki.playvalorant.com/en-us/Prime_Gaming_Drops), [VALORANT X PS+ Bundles](https://wiki.playvalorant.com/en-us/VALORANT_X_PS%2B_Bundles), [Closed Beta](https://wiki.playvalorant.com/en-us/Closed_Beta), [Pick'Ems](https://wiki.playvalorant.com/en-us/Pick'Ems), the two Conflict event pages, and the out-of-game sections of [Sprays](https://wiki.playvalorant.com/en-us/Sprays), [Buddies](https://wiki.playvalorant.com/en-us/Buddies), [Player Cards](https://wiki.playvalorant.com/en-us/Player_Cards) and [Player Titles](https://wiki.playvalorant.com/en-us/Player_Titles) (Channel Drops, Shotcall Extension, Challenge Events, Code Redemption, Pick'Ems, Prime Gaming Drops, Pro play, Miscellaneous, China-Exclusive).

**Left out on purpose:** store, battle pass, agent and Premier rewards; items the wiki lists as unobtainable (in the game files but never handed out); Closed Beta items that were removed from every account at launch; and Radianite Points.
