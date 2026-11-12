// Writes data/items.json, a public copy of data/items.js for other projects to use
// (bots, trackers, spreadsheets). Same items, but image paths are full URLs and the
// file carries its own licence and attribution so it can be used on its own.
//
// Usage: node scripts/export-json.mjs   (build-data.mjs also calls toPublicJson after each build)

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SITE = "https://chillaah.github.io/val-drops/";
export const SCHEMA_VERSION = 1;

const absolute = (src) => (src && !/^https?:\/\//.test(src) ? new URL(src, SITE).href : src);

export function toPublicJson(data) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generated: data.generated,
    site: SITE,
    docs: "https://github.com/chillaah/val-drops#public-data",
    license: {
      data: "CC BY-SA 3.0 (item text from the VALORANT Wiki)",
      url: "https://creativecommons.org/licenses/by-sa/3.0/",
      attribution: "VALORANT Wiki (wiki.playvalorant.com) via VAL DROPS (chillaah.github.io/val-drops)",
      note: "Fan project, not affiliated with or endorsed by Riot Games. VALORANT names and images are property of Riot Games, Inc.",
    },
    primarySource: data.primarySource,
    count: data.items.length,
    items: data.items.map((i) => ({
      ...i,
      url: SITE + "?item=" + encodeURIComponent(i.slug),
      image: absolute(i.image),
      imageLarge: absolute(i.imageLarge),
      imageWide: absolute(i.imageWide),
    })),
  };
}

export async function writePublicJson(data) {
  await writeFile(path.join(ROOT, "data/items.json"), JSON.stringify(toPublicJson(data), null, 1) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const src = await readFile(path.join(ROOT, "data/items.js"), "utf8");
  const data = JSON.parse(src.replace(/^window\.VAL_DROPS = /, "").replace(/;\s*$/, ""));
  await writePublicJson(data);
  console.log(`Wrote data/items.json (${data.items.length} items)`);
}
