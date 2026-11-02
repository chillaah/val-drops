// Exact end times for event Drops, from the official VALORANT Esports schedule.
//
// The wiki only gives dates, so a Drop that ends with an event's final would stay live until
// midnight. Each event in data/curated.json's 'events' names its tournament on
// valorantesports.com; this reads the grand final's scheduled start from the tournament page
// and estimates when co-streamers stop: a full best-of-five after it starts, plus a grace period.
// (vlr.gg has actual map times, but its terms forbid scripted access.)
//
// Usage (to check one event): node scripts/event-times.mjs <official tournament id>

const UA = "Mozilla/5.0 (compatible; val-drops/1.0; +https://github.com/chillaah/val-drops)";
const OFFICIAL = "https://valorantesports.com/en-US/tournament/";
const HOUR = 36e5;
// Co-streamers often keep going after the final so viewers can finish a Drop.
const GRACE = 2 * HOUR;
// A best-of-five at an hour a map, plus breaks between maps and the trophy lift.
const FINAL_LENGTH = 5 * (HOUR + 15 * 60e3);

async function page(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20e3) });
      if (res.ok) return await res.text();
      if (res.status < 500 || attempt >= 2) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (attempt >= 2) throw new Error(`${url}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

// The tournament page is server-rendered with its matches in the page data; the final is the
// last one scheduled.
export async function officialFinal(tournamentId) {
  const html = (await page(`${OFFICIAL}${tournamentId}/overview`)).replace(/\\"/g, '"');
  const starts = [...html.matchAll(/"__typename":"Match","id":"(\d+)"/g)];
  const times = starts.map((m, k) => html.slice(m.index, starts[k + 1]?.index ?? m.index + 4000).match(/"startTime":"([^"]+)"/)?.[1])
    .filter(Boolean).map(Date.parse);
  if (!times.length) throw new Error(`no matches on the official page for tournament ${tournamentId}`);
  return Math.max(...times);
}

// Returns { endsAt, final, warnings }; endsAt is null when the page can't be read.
export async function eventEnd({ official }) {
  try {
    const final = await officialFinal(official);
    return { endsAt: new Date(final + FINAL_LENGTH + GRACE).toISOString(), final, warnings: [] };
  } catch (e) {
    return { endsAt: null, warnings: [e.message] };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  eventEnd({ official: process.argv[2] }).then((r) => console.log(JSON.stringify({ ...r, final: r.final && new Date(r.final).toISOString() }, null, 2)));
}
