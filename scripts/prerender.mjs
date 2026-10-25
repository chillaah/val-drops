// Writes a plain list of every item into index.html, between the prerender
// markers inside <main id="list">. It's what search engines, link previews and
// visitors without JavaScript see; app.js replaces it with the full cards.
//
// Usage: node scripts/prerender.mjs
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const START = "<!-- prerender:start -->";
const END = "<!-- prerender:end -->";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function main() {
  const src = await readFile(path.join(ROOT, "data/items.js"), "utf8");
  const { items } = JSON.parse(src.replace(/^window\.VAL_DROPS\s*=\s*/, "").replace(/;\s*$/, ""));

  // Categories in the order they first appear in the data.
  const byCat = new Map();
  for (const i of items) {
    if (!byCat.has(i.category)) byCat.set(i.category, []);
    byCat.get(i.category).push(i);
  }
  let html = "";
  for (const [cat, list] of byCat) {
    html += `\n    <section class="cat"><h2>${esc(cat)}<span class="count">${list.length}</span></h2><ul class="plain-list">`;
    for (const i of list) {
      const where = i.group !== i.category ? ` · ${esc(i.group)}` : "";
      html += `\n      <li><a href="?item=${esc(i.slug)}">${esc(i.name)}</a> <span>${esc(i.type)}${where}</span></li>`;
    }
    html += `\n    </ul></section>`;
  }

  const file = path.join(ROOT, "index.html");
  const page = await readFile(file, "utf8");
  const a = page.indexOf(START);
  const b = page.indexOf(END);
  if (a < 0 || b < a) throw new Error(`index.html is missing the ${START} / ${END} markers`);
  await writeFile(file, page.slice(0, a + START.length) + html + "\n    " + page.slice(b));
  console.log(`Prerendered ${items.length} items into index.html`);
}

main().catch((e) => { console.error(e); process.exit(1); });
