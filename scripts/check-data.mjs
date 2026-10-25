// Fails if a freshly built data/items.js looks broken, so a wiki layout change
// can't publish a half-empty site.
//
// Usage: node scripts/check-data.mjs <items.js> [previous-items.js]
import { readFile } from "node:fs/promises";

const [newPath, oldPath] = process.argv.slice(2);

// Fewer than this means the scraper missed whole sections.
const MIN_ITEMS = 200;
// Losing more than this share of items in one run is almost never real.
const MAX_DROP = 0.1;
// Every item needs these to render.
const REQUIRED = ["name", "type", "category", "group", "slug"];

async function loadItems(file) {
  const src = await readFile(file, "utf8");
  return JSON.parse(src.replace(/^window\.VAL_DROPS\s*=\s*/, "").replace(/;\s*$/, "")).items;
}

async function main() {
  if (!newPath) throw new Error("Usage: check-data.mjs <items.js> [previous-items.js]");
  const items = await loadItems(newPath);
  const errors = [];

  console.log(`${items.length} items`);
  if (items.length < MIN_ITEMS) errors.push(`Only ${items.length} items (expected at least ${MIN_ITEMS}). The wiki layout may have changed.`);

  const incomplete = items.filter((i) => REQUIRED.some((k) => !i[k]));
  if (incomplete.length) errors.push(`${incomplete.length} items are missing one of ${REQUIRED.join(", ")}, e.g. ${JSON.stringify(incomplete[0].name)}.`);

  const slugs = new Set();
  for (const i of items) {
    if (slugs.has(i.slug)) errors.push(`Duplicate slug ${i.slug}.`);
    slugs.add(i.slug);
  }

  if (oldPath) {
    const prev = await loadItems(oldPath);
    console.log(`${prev.length} items before`);
    if (prev.length && items.length < prev.length * (1 - MAX_DROP)) {
      errors.push(`Item count fell from ${prev.length} to ${items.length} (more than ${MAX_DROP * 100}%). Check the scraper before publishing.`);
    }
  }

  if (errors.length) {
    for (const e of errors) console.error(`::error::${e}`);
    process.exit(1);
  }
  console.log("Data looks OK.");
}

main().catch((e) => { console.error(e); process.exit(1); });
