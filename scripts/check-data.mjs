// Fails if a freshly built data/items.js looks broken, so a wiki layout change
// can't publish a half-empty site.
//
// With a previous build it also holds back the kinds of wiki edit a vandal
// would make: a changed code on an existing item, or a link to a site the data
// has never linked before. Check them on the wiki, then rerun with --approve.
//
// Usage: node scripts/check-data.mjs <items.js> [previous-items.js] [--approve]
import { readFile } from "node:fs/promises";

const [newPath, oldPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPROVED = process.argv.includes("--approve");

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

// ids shift between builds and the wiki moves items between sections, so match on type + name.
const key = (i) => i.type + "§" + i.name.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const host = (url) => { try { return new URL(url).hostname; } catch { return url; } };
const codesOf = (i) => (i.codes || []).map((c) => c.code).sort().join(", ");

// Edits that need a human look before they go live.
function needsReview(items, prev) {
  const before = new Map(prev.map((i) => [key(i), i]));
  const knownHosts = new Set(prev.flatMap((i) => i.sources.map((s) => host(s.url))));
  const out = [];
  for (const i of items) {
    const old = before.get(key(i));
    if (old && codesOf(old) !== codesOf(i)) out.push(`${i.name}: codes changed from [${codesOf(old)}] to [${codesOf(i)}].`);
    for (const s of i.sources) {
      if (!knownHosts.has(host(s.url))) out.push(`${i.name}: links to a new site, ${s.url}`);
    }
  }
  return out;
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
    const review = prev.length ? needsReview(items, prev) : [];
    for (const r of review) console.log(`::${APPROVED ? "notice" : "error"}::Review: ${r}`);
    if (review.length && !APPROVED) {
      errors.push(`${review.length} change(s) need review. Check them on the wiki, then rerun with approval.`);
    }
  }

  if (errors.length) {
    for (const e of errors) console.error(`::error::${e}`);
    process.exit(1);
  }
  console.log("Data looks OK.");
}

main().catch((e) => { console.error(e); process.exit(1); });
