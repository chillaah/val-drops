// Builds data/items.js from the VALORANT Wiki (wiki.playvalorant.com, community-run, CC BY-SA 3.0)
// plus a small hand-curated file (data/curated.json) for items the wiki lacks.
//
// Usage: node scripts/build-data.mjs [--no-images]
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://wiki.playvalorant.com/en-us/api.php";
const WIKI = "https://wiki.playvalorant.com/en-us/";
const UA = "val-drops/1.0 (fan site; data aggregation)";
const SKIP_IMAGES = process.argv.includes("--no-images");

// Item-type pages and the sections on them that cover out-of-game rewards.
// Broadcast/Prime sections overlap the dedicated pages; duplicates are merged in main().
const TYPE_PAGES = [
  { page: "Sprays", type: "Spray" },
  { page: "Buddies", type: "Gun Buddy" },
  { page: "Player Cards", type: "Player Card" },
  { page: "Player Titles", type: "Title" },
];
const TYPE_SECTIONS = {
  "Pick'Ems": "Pick'Ems",
  "Code Redemption": "Code Redemption",
  "Miscellaneous": "Events & Partnerships",
  "Pro play": "Pro Play",
  "Broadcast Drops": "Broadcast Drops",
  "Channel Drops": "Broadcast Drops",
  "Shotcall Extension": "Broadcast Drops",
  "Prime Gaming Drops": "Prime Gaming",
};
// Out-of-game event pages (web challenges with faction rewards).
const EVENT_PAGES = ["Alpha Vs. Omega Conflict", "Champions Conflict: Frag Or Die"];
// Miscellaneous rows that are earned in the client (tutorials, in-game modes, defaults).
const IN_GAME = /Basic Training|default (card|spray|buddy)|Skirmish|Night Queue|Snowball Fight|MAHASONGKRAN|Console|Given to all existing accounts/i;

// Sub-groups for the wiki's catch-all "Miscellaneous" sections, first match wins.
const MISC_GROUPS = [
  [/Alpha Vs\. Omega Conflict/i, "Alpha Vs. Omega Conflict"],
  [/Frag Or Die/i, "Champions Conflict: Frag Or Die"],
  [/Coinbase|Verizon|Xbox|ExpressVPN/i, "Brand partnerships"],
  [/Shotcall/i, "Shotcall (Twitch extension)"],
  [/Merch|Figure|Plushie/i, "Merch & collectibles"],
  [/Watch Part|Attend|co-streamers|in-person/i, "Watch parties, co-streams & live events"],
  [/RiotXArcane/i, "RiotX Arcane web event"],
];

const CATEGORY_TYPES = {
  "Sprays": "Spray",
  "Buddies": "Gun Buddy",
  "Player Cards": "Player Card",
  "Player Titles": "Title",
  "Weapon Skins": "Gun Skin",
};

// ---------- fetching ----------

async function api(params) {
  const url = API + "?" + new URLSearchParams({ format: "json", formatversion: "2", ...params });
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}

async function wikitext(page) {
  const d = await api({ action: "parse", page, prop: "wikitext|revid" });
  if (d.error) throw new Error(`${page}: ${d.error.info}`);
  return d.parse.wikitext;
}

// ---------- wikitext helpers ----------

const pageUrl = (title) => WIKI + encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/");

function extractUrls(s) {
  const urls = new Set();
  for (const m of s.matchAll(/https?:\/\/[^\s|\]<}]+/g)) urls.add(m[0].replace(/[.,)]+$/, ""));
  return [...urls];
}

function extractWikiLinks(s) {
  return [...s.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)]
    .map((m) => m[1].trim())
    .filter((t) => !/^(File|Category|[a-z]{2}):/i.test(t));
}

// Strip refs out of text, returning [text, urls]
function takeRefs(s) {
  const urls = [];
  const grab = (inner) => { urls.push(...extractUrls(inner)); return ""; };
  s = s.replace(/\{\{#tag:ref\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}/g, (_, i) => grab(i));
  s = s.replace(/<ref[^>/]*>([\s\S]*?)<\/ref>/g, (_, i) => grab(i));
  s = s.replace(/<ref[^>]*\/>/g, "");
  return [s, urls];
}

function clean(s) {
  if (!s) return "";
  [s] = takeRefs(s);
  return s
    .replace(/<s>[\s\S]*?<\/s>/g, "")
    .replace(/\{\{tt\|[^{}]*\}\}/g, "")
    .replace(/\{\{collection\|[^|}]*\|([^}]*)\}\}/g, "$1")
    .replace(/\{\{collection\|([^}]*)\}\}/g, "$1")
    .replace(/\{\{patchv\|([^}]*)\}\}/g, "Patch $1")
    .replace(/\{\{#tag:code\|([^}]*)\}\}/g, "$1")
    .replace(/\{\{VP\|([^}]*)\}\}/g, "$1 VP")
    .replace(/\{\{Playertitle\|([^}]*)\}\}/g, "$1")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1")
    .replace(/\[https?:\/\/\S+\]/g, "")
    .replace(/<br\s*\/?>/g, " / ")
    .replace(/<\/?(code|small|span|div|center)[^>]*>/g, "")
    .replace(/'''?/g, "")
    .replace(/^\s*[*:]\s*/gm, "• ")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[/\s]+/, "");
}

// Split a wikitext table cell into [attrs, content]
function splitAttrs(cell) {
  const m = cell.match(/^((?:\s*[\w-]+\s*=\s*(?:"[^"]*"|[^\s|;"]+)[;\s]*)+)\|(?!\|)([\s\S]*)$/);
  return m && !/\[\[|\{\{/.test(m[1]) ? [m[1], m[2]] : ["", cell];
}
const attr = (attrs, name) => Number((attrs.match(new RegExp(name + '\\s*=\\s*"?(\\d+)')) || [])[1] || 1);

// Parse one {| ... |} table into { headers, rows } where each row is
// { kind: "cells" | "header", cells: [{text}] } with rowspans already filled in.
function parseTable(src) {
  const rawRows = [];
  let row = null;
  let cell = null;
  for (const line of src.split("\n")) {
    if (/^\s*\{\|/.test(line) || /^\s*\|\}/.test(line) || /^\s*\|\+/.test(line)) continue;
    if (/^\s*\|-/.test(line)) { row = null; cell = null; continue; }
    const m = line.match(/^\s*([|!])(.*)$/);
    if (m) {
      if (!row) { row = []; rawRows.push(row); }
      const sep = m[1] === "!" ? /!!|\|\|/ : /\|\|/;
      for (const part of m[2].split(sep)) {
        const [attrs, text] = splitAttrs(part);
        cell = { header: m[1] === "!", text, rowspan: attr(attrs, "rowspan"), colspan: attr(attrs, "colspan") };
        row.push(cell);
      }
    } else if (cell) {
      cell.text += "\n" + line;
    }
  }
  // Fill rowspans.
  const carry = []; // column -> {cell, left}
  const rows = [];
  let headers = null;
  for (const raw of rawRows) {
    if (raw.every((c) => c.header)) {
      if (raw.length === 1 && raw[0].colspan >= 3) rows.push({ kind: "group", text: clean(raw[0].text) });
      else if (!headers) headers = raw.flatMap((c) => Array(c.colspan).fill(clean(c.text)));
      continue;
    }
    const out = [];
    let col = 0;
    const queue = [...raw];
    while (queue.length || carry.slice(col).some((c) => c && c.left > 0)) {
      if (carry[col] && carry[col].left > 0) {
        out.push(carry[col].cell); carry[col].left--; col++; continue;
      }
      const c = queue.shift();
      if (!c) { col++; continue; }
      out.push(c);
      if (c.rowspan > 1) carry[col] = { cell: c, left: c.rowspan - 1 };
      for (let k = 1; k < c.colspan; k++) out.push({ text: "", spanned: true });
      col += c.colspan;
    }
    rows.push({ kind: "cells", cells: out });
  }
  return { headers: headers || [], rows };
}

function findTables(text) {
  // Returns top-level tables only; nested tables (e.g. score boxes inside a cell) are dropped.
  const tables = [];
  let depth = 0, cur = null;
  for (const line of text.split("\n")) {
    if (/^\s*\{\|/.test(line)) {
      if (depth++ === 0) cur = [line];
    } else if (/^\s*\|\}/.test(line) && depth > 0) {
      if (--depth === 0) { cur.push(line); tables.push(cur.join("\n")); }
    } else if (depth === 1) {
      cur.push(line);
    }
  }
  return tables;
}

function parseGalleries(text) {
  const items = [];
  for (const g of text.matchAll(/<gallery[^>]*>([\s\S]*?)<\/gallery>/g)) {
    for (const line of g[1].split("\n")) {
      const m = line.match(/^\s*([^|]+\.(?:png|gif|jpg|jpeg|webp))\s*\|(.*)$/i);
      if (!m) continue;
      const [caption, refs] = takeRefs(m[2]);
      items.push({ file: m[1].trim(), name: clean(caption), refs });
    }
  }
  return items;
}

// Sections at exactly `level`; each body runs until the next heading of the same or higher level.
function sections(text, level) {
  const headings = [...text.matchAll(/^(=+)\s*(.*?)\s*\1\s*$/gm)];
  const out = [];
  headings.forEach((m, i) => {
    if (m[1].length !== level) return;
    const next = headings.slice(i + 1).find((h) => h[1].length <= level);
    const end = next ? next.index : text.length;
    out.push({ title: clean(m[2]), rawTitle: m[2], body: text.slice(m.index + m[0].length, end) });
  });
  return out;
}

function typeFromName(name) {
  if (/ Spray$/i.test(name)) return "Spray";
  if (/ Buddy$/i.test(name)) return "Gun Buddy";
  if (/ Card$/i.test(name)) return "Player Card";
  if (/ Title$/i.test(name)) return "Title";
  return undefined;
}

// Turn table rows into items. `defaults` supplies type/category/group info.
function itemsFromTable(tableSrc, defaults) {
  const { headers, rows } = parseTable(tableSrc);
  const items = [];
  const tableSources = [];
  let sub = null;
  for (const row of rows) {
    if (row.kind === "group") { sub = row.text; continue; }
    const cells = row.cells;
    const joined = cells.map((c) => c.text).join(" ");
    if (cells.filter((c) => !c.spanned && c.text.trim()).length === 1 && /Information:/i.test(joined)) {
      tableSources.push(...extractUrls(joined));
      continue;
    }
    const i = cells.findIndex((c) => /\[\[File:|\{\{Playertitle\|/i.test(c.text));
    if (i < 0) continue;
    const imgCell = cells[i].text;
    const fileM = imgCell.match(/\[\[File:([^|\]]+)/i);
    const titleM = imgCell.match(/\{\{Playertitle\|([^}|]+)\}\}/i);
    let nameIdx = i + 1;
    let name;
    if (titleM) {
      const next = clean(cells[i + 1]?.text);
      if (next && / Title$/.test(next)) name = next;
      else { name = `${titleM[1].trim()} Title`; nameIdx = i; }
    } else {
      name = clean(cells[i + 1]?.text);
    }
    const refs = [...takeRefs(cells.map((c) => c.text).join("\n"))[1]];
    const details = [];
    let type = defaults.type;
    cells.forEach((c, k) => {
      if (k === i || k === nameIdx || c.spanned) return;
      const h = headers[k] || "";
      const v = clean(c.text);
      if (!v) return;
      if (/category$/i.test(h)) { type = CATEGORY_TYPES[v] || v; return; }
      // Inline links inside a cell (e.g. merch product pages) are sources too.
      refs.push(...extractUrls(c.text.replace(/<ref[\s\S]*?<\/ref>/g, "")));
      details.push({ label: h, value: v });
    });
    const wikiLinks = extractWikiLinks(cells.slice(nameIdx + 1).map((c) => c.text).join(" "))
      .filter((t) => !CATEGORY_TYPES[t]);
    type ||= typeFromName(name);
    items.push({
      ...defaults,
      type,
      name,
      file: fileM ? fileM[1].trim() : null,
      title: titleM ? titleM[1].trim() : null,
      subgroup: sub || defaults.subgroup || null,
      details,
      refs: [...new Set(refs)],
      wikiLinks,
    });
  }
  for (const it of items) it.refs.push(...tableSources);
  return items;
}

// ---------- page parsers ----------

async function parseBroadcastDrops() {
  const text = await wikitext("Broadcast Drops");
  const items = [];
  for (const sec of sections(text, 2)) {
    if (/^(References|Navigation|Notes)$/i.test(sec.title)) continue;
    const prose = sec.body.replace(/\{\|[\s\S]*?\n\|\}/g, "");
    const eventRefs = takeRefs(prose)[1];
    const note = clean(prose.replace(/^:.*$/gm, "").replace(/\[\[File:[^\]]*\]\]/g, ""));
    for (const t of findTables(sec.body)) {
      for (const it of itemsFromTable(t, { category: "Broadcast Drops", group: sec.title, wikiPage: "Broadcast Drops" })) {
        it.refs.push(...eventRefs);
        it.groupNote = note || null;
        items.push(it);
      }
    }
  }
  return items;
}

async function parsePrimeGaming() {
  const text = await wikitext("Prime Gaming Drops");
  const items = [];
  for (const t of findTables(text)) {
    for (const it of itemsFromTable(t, { category: "Prime Gaming", group: "Prime Gaming Drops (2020–2024)", wikiPage: "Prime Gaming Drops" })) {
      items.push(it);
    }
  }
  return items;
}

async function parsePSPlus() {
  const text = await wikitext("VALORANT X PS+ Bundles");
  const items = [];
  // Sections are newest first; the newest bundle is the one currently claimable.
  sections(text, 3).forEach((sec, idx) => {
    const start = monthStart(sec.title);
    for (const t of findTables(sec.body)) {
      for (const it of itemsFromTable(t, { category: "PlayStation Plus", group: `PS+ Bundle — ${sec.title}`, wikiPage: "VALORANT X PS+ Bundles" })) {
        if (idx === 0) it.ongoing = { since: start, note: "Current PS+ bundle. Bundles rotate about every three months." };
        items.push(it);
      }
    }
  });
  return items;
}

async function parseTypePage({ page, type }) {
  const text = await wikitext(page);
  const items = [];
  for (const sec of [...sections(text, 3), ...sections(text, 4)]) {
    const category = TYPE_SECTIONS[sec.title];
    if (!category) continue;
    const defaults = { type, category, group: category, wikiPage: page };
    const body = sec.body.replace(/<gallery[^>]*>[\s\S]*?<\/gallery>/g, "");
    const galleryItems = parseGalleries(sec.body);
    // Pick'Ems buddy galleries live inside a "Criteria" table; keep the criteria label.
    const criteria = [...sec.body.matchAll(/\|\s*([^\n|]+)\n\|\s*<gallery[^>]*>([\s\S]*?)<\/gallery>/g)];
    for (const g of galleryItems) {
      const crit = criteria.find((c) => c[2].includes(g.file));
      items.push({
        ...defaults, name: g.name, file: g.file, title: null, subgroup: null,
        details: crit ? [{ label: "Criteria", value: clean(crit[1]) }] : [],
        refs: g.refs, wikiLinks: [],
      });
    }
    for (const t of findTables(body)) {
      // Pick'Ems title tables use a single header ("Participation" / "Perfect Picks") as the subgroup.
      const head = t.match(/^\s*!([^\n]+)\n\|-\n!Title/m);
      for (const it of itemsFromTable(t, defaults)) {
        if (head && !it.subgroup) it.subgroup = clean(head[1]);
        items.push(it);
      }
    }
  }
  return items.filter((it) => {
    if (it.category !== "Events & Partnerships") return true;
    const how = it.details.map((d) => d.value).join(" ");
    it.group = (MISC_GROUPS.find(([re]) => re.test(how)) || [, "Other promotions & rewards"])[1];
    return !IN_GAME.test(how) || /Broadcast Drops|Coinbase|Watch Party|attend/i.test(how);
  });
}

async function parseEventPage(page) {
  const text = await wikitext(page);
  const items = [];
  for (const t of findTables(text)) {
    for (const it of itemsFromTable(t, { category: "Events & Partnerships", group: page, wikiPage: page })) {
      it.refs.push("https://ftw.riotgames.com/en-us/valorant");
      items.push(it);
    }
  }
  return items;
}

// ---------- dates ----------
// Wiki dates are mostly Pacific time. Periods are stored as YYYY-MM-DD and the
// site treats them as whole days in PT.

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON = `(${MONTHS.join("|")})`;
const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const monthIdx = (s) => MONTHS.indexOf(s.toLowerCase());

function monthStart(s) {
  const m = s.match(new RegExp(`${MON}\\s+(\\d{4})`, "i"));
  return m ? iso(+m[2], monthIdx(m[1]), 1) : null;
}

// Every date range or single date in a string, as [{start, end}] (start may be null).
function findPeriods(text) {
  const s = text
    .replace(/\b\d{1,2}:\d{2}\s*(am|pm)?/gi, "") // times
    .replace(/\b(PT|PST|PDT|KST|JST|UTC)\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/(\s*,)+/g, ",");
  const out = [];
  const taken = [];
  const range = new RegExp(`${MON} ${DAY}(?:,? (\\d{4}))?,? ?(?:-|–|to|&) ?(?:${MON} )?${DAY},? (\\d{4})`, "gi");
  for (const m of s.matchAll(range)) {
    const y2 = +m[6], m2 = m[4] ? monthIdx(m[4]) : monthIdx(m[1]);
    const m1 = monthIdx(m[1]);
    const y1 = m[3] ? +m[3] : m1 > m2 ? y2 - 1 : y2;
    out.push({ start: iso(y1, m1, +m[2]), end: iso(y2, m2, +m[5]) });
    taken.push([m.index, m.index + m[0].length]);
  }
  const single = new RegExp(`(till|until|by|before|redeemable)?\\s*${MON} ${DAY},? (\\d{4})`, "gi");
  for (const m of s.matchAll(single)) {
    const at = m.index + m[0].length;
    if (taken.some(([a, b]) => at > a && at <= b)) continue;
    const d = iso(+m[4], monthIdx(m[2]), +m[3]);
    out.push({ start: m[1] ? null : d, end: d });
  }
  // "Expiry: May 2026" style: whole month.
  if (!out.length) {
    const m = s.match(new RegExp(`^${MON} (\\d{4})\\*?$`, "i"));
    if (m) {
      const y = +m[2], mo = monthIdx(m[1]);
      out.push({ start: null, end: iso(y, mo, new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()) });
    }
  }
  return out;
}

// The claim window for an item: the period with the latest end across its details.
function itemPeriod(detailRows) {
  let best = null;
  let openCode = false;
  for (const row of detailRows) {
    for (const d of row) {
      const label = d.label || "";
      if (!/date|expir|acqui|objective/i.test(label)) continue;
      if (/expir/i.test(label) && /unknown/i.test(d.value)) openCode = true;
      // Some tables put the year only in the column header, e.g. "Challenge Dates (2026, PT)".
      const headerYear = (label.match(/\b(20\d\d)\b/) || [])[1];
      const value = headerYear && !/\b(19|20)\d\d\b/.test(d.value) ? `${d.value}, ${headerYear}` : d.value;
      for (const p of findPeriods(value)) {
        if (/expir/i.test(label)) p.start = null; // an expiry date only bounds the end
        if (!best || p.end > best.end) best = p;
      }
    }
  }
  return { period: best, openCode };
}

// ---------- merge, images, sources ----------

const SOURCE_LABELS = [
  [/valorantesports\.com/, "VALORANT Esports", true],
  [/playvalorant\.com/, "PlayVALORANT.com", true],
  [/support-valorant\.riotgames\.com/, "Riot Support", true],
  [/merch\.riotgames\.com/, "Riot Games Merch", true],
  [/riotgames\.com/, "Riot Games", true],
  [/lolesports\.com/, "LoL Esports", true],
  [/coinbase\.com/, "Coinbase", false],
  [/expressvpn\.com/, "ExpressVPN", false],
  [/popmart\.com/, "POP MART", false],
  [/youtube\.com|youtu\.be/, "YouTube", false],
  [/instagram\.com/, "Instagram", false],
  [/(twitter|x)\.com/, "X", false],
];
const RIOT_HANDLES = /^(valorant\w*|playvalorant|riot\w*|valesports\w*|vct\w*|lolesports)$/i;

function describeSource(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  for (const [re, label, official] of SOURCE_LABELS) {
    if (!re.test(host)) continue;
    if (label === "X" || label === "Instagram") {
      const handle = new URL(url).pathname.split("/")[1];
      if (handle && handle !== "p") return { url, label: `${label} @${handle}`, official: RIOT_HANDLES.test(handle) };
      return { url, label: `${label} post`, official: false };
    }
    if (label === "YouTube") return { url, label, official: false };
    return { url, label, official };
  }
  return { url, label: host.replace(/^www\./, ""), official: false };
}

async function resolveImages(files) {
  const out = {};
  const list = [...new Set(files.filter(Boolean))];
  for (let i = 0; i < list.length; i += 50) {
    const batch = list.slice(i, i + 50);
    const d = await api({
      action: "query", prop: "imageinfo", iiprop: "url", iiurlwidth: "256",
      titles: batch.map((f) => "File:" + f).join("|"),
    });
    const norm = Object.fromEntries((d.query.normalized || []).map((n) => [n.to, n.from]));
    for (const p of d.query.pages) {
      const original = (norm[p.title] || p.title).replace(/^File:/, "");
      const info = p.imageinfo?.[0];
      if (info) out[original] = { thumb: info.thumburl || info.url, page: info.descriptionurl };
    }
  }
  return out;
}

const slug = (s) => s.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function download(url, dest) {
  if (await exists(dest)) return true;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return false;
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function main() {
  console.log("Fetching wiki pages…");
  const raw = [
    ...(await parseBroadcastDrops()),
    ...(await parsePrimeGaming()),
    ...(await parsePSPlus()),
    ...(await Promise.all(EVENT_PAGES.map(parseEventPage))).flat(),
  ].filter((it) => it.name && Object.values(CATEGORY_TYPES).includes(it.type));

  // Type pages fill gaps; an item already listed by a dedicated page in the same
  // category just contributes its extra citations.
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byName = new Map(raw.map((it) => [it.category + "§" + norm(it.name), it]));
  const typeItems = (await Promise.all(TYPE_PAGES.map(parseTypePage))).flat();
  for (const it of typeItems) {
    if (!it.name) continue;
    const dup = byName.get(it.category + "§" + norm(it.name));
    if (dup) { dup.refs.push(...it.refs); continue; }
    if (it.category === "Broadcast Drops") it.group = "Other broadcast drops";
    if (it.category === "Prime Gaming") it.group = "Prime Gaming Drops (2020–2024)";
    raw.push(it);
  }

  const curated = JSON.parse(await readFile(path.join(ROOT, "data/curated.json"), "utf8"));
  for (const it of curated.items) raw.push({ details: [], wikiLinks: [], subgroup: null, title: null, ...it, curated: true });

  // Merge duplicate rows (e.g. rowspan'd pro-play buddies) within the same group.
  const merged = new Map();
  for (const it of raw) {
    const key = [it.category, it.group, it.subgroup, it.name].join("§");
    const prev = merged.get(key);
    if (prev) {
      prev.detailRows.push(it.details);
      prev.refs.push(...it.refs);
    } else {
      merged.set(key, { ...it, detailRows: [it.details], refs: [...it.refs] });
    }
  }

  const images = await resolveImages([...merged.values()].map((i) => i.file));
  const imgDir = path.join(ROOT, "img");
  await mkdir(imgDir, { recursive: true });

  const items = [];
  let n = 0;
  for (const it of merged.values()) {
    const img = it.file && images[it.file];
    let image = null;
    if (img) {
      const ext = path.extname(new URL(img.thumb).pathname) || ".png";
      const local = "img/" + slug(it.file.replace(/\.\w+$/, "")) + ext;
      image = SKIP_IMAGES ? img.thumb : (await download(img.thumb, path.join(ROOT, local))) ? local : img.thumb;
    } else if (it.file && !it.curated) {
      console.warn("  ! no image for", it.file);
    }
    const urls = [...new Set(it.refs)];
    const sources = urls.map(describeSource).filter(Boolean);
    const wikiPages = [...new Set([it.wikiPage, ...it.wikiLinks].filter(Boolean))];
    for (const p of wikiPages) sources.push({ url: pageUrl(p), label: `VALORANT Wiki: ${p}`, official: false, wiki: true });
    items.push({
      id: ++n,
      name: it.name,
      type: it.type,
      category: it.category,
      group: it.group,
      subgroup: it.subgroup,
      groupNote: it.groupNote || null,
      title: it.title,
      image,
      details: it.detailRows.filter((r) => r.length),
      ...(() => {
        const { period, openCode } = itemPeriod(it.detailRows);
        return {
          period,
          ongoing: it.ongoing || null,
          // A public code whose expiry the wiki lists as unknown may still work.
          maybeActive: it.category === "Code Redemption" && openCode,
        };
      })(),
      sources,
    });
    if (n % 50 === 0) process.stdout.write(`  ${n} items\r`);
  }

  const out = {
    generated: new Date().toISOString(),
    primarySource: { label: "VALORANT Wiki", url: WIKI },
    items,
  };
  await writeFile(path.join(ROOT, "data/items.js"), "window.VAL_DROPS = " + JSON.stringify(out, null, 1) + ";\n");
  const counts = items.reduce((a, i) => ((a[i.category] = (a[i.category] || 0) + 1), a), {});
  console.log(`Wrote ${items.length} items`, counts);
}

main().catch((e) => { console.error(e); process.exit(1); });
