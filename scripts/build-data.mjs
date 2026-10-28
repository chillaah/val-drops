// Builds data/items.js from the VALORANT Wiki (wiki.playvalorant.com, community-run, CC BY-SA 3.0)
// plus a small hand-curated file (data/curated.json) for items the wiki lacks.
//
// Usage: node scripts/build-data.mjs [--no-images]
import { mkdir, readFile, writeFile, access, readdir, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://wiki.playvalorant.com/en-us/api.php";
const WIKI = "https://wiki.playvalorant.com/en-us/";
const UA = "val-drops/1.0 (fan site; data aggregation)";
const SKIP_IMAGES = process.argv.includes("--no-images");
// Card thumbnails show at most 256x144 CSS pixels; this box is enough for
// high-DPI screens. The wiki scales tall player cards down to fit.
const THUMB_BOX = [256, 288];

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
  // Drops from Riot's FTW website challenges. Earned by playing, but run and
  // announced outside the client, so they count.
  "Challenge Events": "Events & Partnerships",
  "China-Exclusive": "China Exclusive",
};
// Out-of-game event pages (web challenges with faction rewards).
const EVENT_PAGES = ["Alpha Vs. Omega Conflict", "Champions Conflict: Frag Or Die", "Night Queue", "MAHASONGKRAN"];
const FTW = "https://ftw.riotgames.com/en-us/valorant";
const CHALLENGE_NOTE = "Drop rewards from challenge events on Riot's FTW website: complete the listed challenges in game, then claim the reward on the site.";
const CHINA = { code: "CN", label: "China only" };
// Pro Play items go to players and staff on competing or winning teams, not viewers.
const PRO_ONLY = { code: "PRO", label: "Pro players only" };
const PICKEMS = "https://valorantesports.com/en-US/pickems";
const PICKEMS_NOTE = "Make your picks on the VALORANT Esports site or in the client's Esports tab while the pick window is open. Taking part earns the participation reward; finishing in the top 50% earns the buddy, and the top 20% get both buddies.";
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
  // Follow redirects: the wiki renames pages (Broadcast Drops → Broadcast Rewards).
  const d = await api({ action: "parse", page, prop: "wikitext|revid", redirects: "1" });
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
    // Tooltips ({{tt|*|note}}) carry notes like a shortened claim window; keep the note.
    .replace(/\{\{tt\|[^|{}]*\|([^{}]*)\}\}/g, " ($1)")
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
      // Line breaks in headers are layout only ("Points<br>Required").
      else if (!headers) headers = raw.flatMap((c) => Array(c.colspan).fill(clean(c.text.replace(/<br\s*\/?>/g, " "))));
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

// Each bundle runs from its month until the month before the next one starts.
// Neither the wiki nor Riot gives exact days, so the dates are by month.
const PSPLUS_NOTE = "Bundles rotate about every three months, and an old bundle can't be claimed once the next one is out. Dates are by month: Riot doesn't publish exact start and end days.";

async function parsePSPlus() {
  const text = await wikitext("VALORANT X PS+ Bundles");
  const items = [];
  // Sections are newest first; the newest bundle is the one currently claimable.
  // Older ones are titled "Year End" / "Launch" and give their month in the prose.
  const bundles = sections(text, 3).map((sec) => ({ ...sec, start: monthStart(sec.title) || monthStart(sec.body.match(/released in ([A-Za-z]+ \d{4})/)?.[1] || "") }));
  const monthName = (d) => MONTHS[+d.slice(5, 7) - 1].replace(/^./, (c) => c.toUpperCase());
  bundles.forEach((sec, idx) => {
    const { start } = sec;
    if (!start) throw new Error(`No month for PS+ bundle "${sec.title}". The wiki page may have changed layout.`);
    // The day before the next (newer) bundle's month.
    const next = bundles[idx - 1]?.start;
    const end = next && new Date(Date.parse(next) - 864e5).toISOString().slice(0, 10);
    const span = !end ? null
      : start.slice(0, 7) === end.slice(0, 7) ? `${monthName(start)} ${start.slice(0, 4)}`
      : start.slice(0, 4) === end.slice(0, 4) ? `${monthName(start)} - ${monthName(end)} ${end.slice(0, 4)}`
      : `${monthName(start)} ${start.slice(0, 4)} - ${monthName(end)} ${end.slice(0, 4)}`;
    for (const t of findTables(sec.body)) {
      for (const it of itemsFromTable(t, { category: "PlayStation Plus", group: `PS+ Bundle — ${sec.title}`, wikiPage: "VALORANT X PS+ Bundles" })) {
        it.groupNote = PSPLUS_NOTE;
        if (end) {
          it.period = { start, end };
          it.details.push({ label: "Available", value: span });
        } else {
          it.ongoing = { since: start, note: `Current PS+ bundle since ${monthName(start)} ${start.slice(0, 4)}. No end date announced; bundles rotate about every three months.` };
          it.details.push({ label: "Available", value: `${monthName(start)} ${start.slice(0, 4)} until the next bundle` });
        }
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
    const defaults = { type, category, group: category, wikiPage: page, challenge: sec.title === "Challenge Events" };
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
  for (const it of items) {
    if (it.category === "China Exclusive") it.regions = [CHINA];
    if (!it.challenge) continue;
    it.group = it.details.find((d) => d.label === "Event")?.value || "FTW challenge events";
    it.groupNote = CHALLENGE_NOTE;
    it.refs.push(FTW);
  }
  return items.filter((it) => {
    if (it.category !== "Events & Partnerships" || it.challenge) return true;
    const how = it.details.map((d) => d.value).join(" ");
    it.group = (MISC_GROUPS.find(([re]) => re.test(how)) || [, "Other promotions & rewards"])[1];
    return !IN_GAME.test(how) || /Broadcast Drops|Coinbase|Watch Party|attend/i.test(how);
  });
}

// One section per tournament: a rewards table (target, points needed, players
// eligible) and a pick window per stage ("Runtime for this portion ... was <dates>").
async function parsePickEms() {
  const text = await wikitext("Pick'Ems");
  const items = [];
  for (const sec of sections(text, 2)) {
    if (/^(References|Navigation|Notes)$/i.test(sec.title)) continue;
    const body = sec.body
      .replace(/ TItle\b/g, " Title") // typo in several rows
      // "<br>{{#tag:small|+ X Buddy}}" notes that top 20% also get the top 50% buddy (see PICKEMS_NOTE).
      .replace(/(<br\s*\/?>)?\s*\{\{#tag:small\|[^{}]*\}\}/g, "");
    const windows = [];
    // Stage subsections first so their windows get a stage name; then any window outside one.
    for (const stage of [...sections(body, 4), { title: null, body }]) {
      for (const m of stage.body.matchAll(/Runtime for this portion of (?:the|this) event was ([^.\n]+)/g)) {
        const p = findPeriods(m[1])[0];
        if (p && !windows.some((w) => w.p.start === p.start)) windows.push({ stage: stage.title, value: m[1].trim(), p });
      }
    }
    windows.sort((a, b) => a.p.start.localeCompare(b.p.start));
    const dates = [];
    if (windows.length) {
      // "October 16 - 22, 2026", "February 19 - March 6, 2026" or, across a new year, both years.
      const part = (d) => d.split("-").map(Number);
      const month = (m) => MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1);
      const [y1, m1, d1] = part(windows[0].p.start), [y2, m2, d2] = part(windows.at(-1).p.end);
      const value = y1 !== y2 ? `${month(m1)} ${d1}, ${y1} - ${month(m2)} ${d2}, ${y2}`
        : m1 !== m2 ? `${month(m1)} ${d1} - ${month(m2)} ${d2}, ${y2}` : `${month(m1)} ${d1} - ${d2}, ${y2}`;
      dates.push({ label: "Pick'Em Dates", value });
      if (windows.length > 1) dates.push({ label: "Pick windows", value: windows.map((w) => (w.stage ? `${w.stage}: ` : "") + w.value).join(" • ") });
    }
    const rewards = (body.match(/===\s*Rewards\s*===([\s\S]*?)(?=\n===|$)/) || [])[1];
    for (const t of findTables(rewards || "")) {
      for (const it of itemsFromTable(t, { category: "Pick'Ems", group: sec.title, wikiPage: "Pick'Ems" })) {
        it.details = [
          ...it.details
            .filter((d) => !/^(—|-|TBD)$/i.test(d.value))
            .map((d) => (/^Eligible/i.test(d.label) ? { label: "Players who qualified", value: d.value } : d)),
          ...dates,
        ];
        it.groupNote = PICKEMS_NOTE;
        it.refs.push(PICKEMS);
        items.push(it);
      }
    }
  }
  return items;
}

// The 2020 Closed Beta's reward pass. Players got into the beta through Twitch
// drops, and these items stayed on their accounts after launch (the beta items
// removed at launch are left out).
async function parseClosedBeta() {
  const text = await wikitext("Closed Beta");
  const items = [];
  for (const sec of sections(text, 3)) {
    for (const t of findTables(sec.body)) {
      for (const it of itemsFromTable(t, { category: "Closed Beta", group: `Closed Beta ${sec.title === "Pass" ? "reward pass" : "rewards"}`, wikiPage: "Closed Beta" })) {
        it.details = [...it.details.filter((d) => /tier|source/i.test(d.label)), { label: "Eligible Dates", value: "April 7 - May 28, 2020" }];
        if (it.type === "Title") it.file = null; // the table uses a generic title image
        items.push(it);
      }
    }
  }
  return items;
}

async function parseEventPage(page) {
  const text = await wikitext(page);
  const items = [];
  // Some pages give one window for the whole event instead of a date per reward.
  const runtime = (text.match(/Runtime for this event was ([^.\n]+)/) || [])[1]?.trim();
  for (const t of findTables(text)) {
    for (const it of itemsFromTable(t, { category: "Events & Partnerships", group: page, wikiPage: page })) {
      it.refs.push(FTW);
      it.groupNote = CHALLENGE_NOTE;
      if (runtime && !it.details.some((d) => /date/i.test(d.label || ""))) it.details.push({ label: "Event Dates", value: runtime });
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
  // "Date: May 2023" or "Expiry: May 2026" style: the whole month (itemPeriod drops the start for expiries).
  if (!out.length) {
    const m = s.match(new RegExp(`^${MON} (\\d{4})\\*?$`, "i"));
    if (m) {
      const y = +m[2], mo = monthIdx(m[1]);
      out.push({ start: iso(y, mo, 1), end: iso(y, mo, new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()) });
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
      // Drop bracketed notes first: "(originally till October 18th, 2026; ...)" isn't the window.
      const text = d.value.replace(/\s*\([^()]*\)/g, "");
      const value = headerYear && !/\b(19|20)\d\d\b/.test(text) ? `${text}, ${headerYear}` : text;
      for (const p of findPeriods(value)) {
        if (/expir/i.test(label)) p.start = null; // an expiry date only bounds the end
        if (!best || p.end > best.end) best = p;
      }
    }
  }
  return { period: best, openCode };
}

// ---------- redemption codes ----------
// Pairs each public code with its expiry. Rows can hold several codes and
// expiries as parallel bullet lists (e.g. the yearly Pride card codes).
function parseCodes(detailRows) {
  const split = (v) => v.split(/\s*•\s*/).map((x) => x.trim()).filter(Boolean);
  const cells = detailRows.flat();
  const codes = cells.filter((d) => /^code$/i.test(d.label)).flatMap((d) => split(d.value));
  const expiries = cells.filter((d) => /expir/i.test(d.label)).flatMap((d) => split(d.value));
  if (!codes.length) return null;
  return codes.map((raw, k) => {
    const exp = expiries.length === codes.length ? expiries[k] : expiries[0] || "";
    const end = findPeriods(exp.replace(/\*$/, ""))[0]?.end || null;
    return {
      code: raw.replace(/\*$/, ""),
      expires: end,
      // "*" marks codes for Riot's old redemption site, which no longer exists.
      defunct: raw.endsWith("*") || exp.endsWith("*"),
    };
  });
}

// ---------- region limits ----------
// Only restrictions the source text states outright; nothing inferred from a
// partner's home country or a timezone.
const REGION_RULES = [
  [/residing (in )?South Korea|players in (South )?Korea/i, { code: "KR", label: "South Korea only" }],
  [/exclusively for players in Japan|players residing (in )?Japan/i, { code: "JP", label: "Japan only" }],
  [/ONE Pro Invitational in Japan/i, { code: "JP-IRL", label: "In person: Japan" }],
  [/in-person Watch Parties across the Americas/i, { code: "AMER-IRL", label: "In person: Americas" }],
  // Riot's FTW challenge rules list banned regions/countries.
  [/Frag Or Die|Alpha Vs\. Omega Conflict|Night Queue/i, { code: "EXCL", label: "Not in some countries" }],
  [/MAHASONGKRAN/, { code: "TH", label: "Thailand only" }],
];

function regionTags(it) {
  const text = [it.group, it.subgroup, ...it.detailRows.flat().map((d) => d.value)].filter(Boolean).join(" | ");
  const tags = REGION_RULES.filter(([re]) => re.test(text)).map(([, t]) => t);
  for (const t of it.regions || []) tags.push(t); // curated entries can declare their own
  if (it.category === "Pro Play") tags.push(PRO_ONLY);
  return [...new Map(tags.map((t) => [t.code, t])).values()];
}

// ---------- merge, images, sources ----------

// Matched against the whole hostname, so "riotgames.com.example.net" isn't labelled official.
const SOURCE_LABELS = [
  [/(^|\.)valorantesports\.com$/, "VALORANT Esports", true],
  [/(^|\.)playvalorant\.com$/, "PlayVALORANT.com", true],
  [/^support-valorant\.riotgames\.com$/, "Riot Support", true],
  [/^merch\.riotgames\.com$/, "Riot Games Merch", true],
  [/(^|\.)riotgames\.com$/, "Riot Games", true],
  [/(^|\.)lolesports\.com$/, "LoL Esports", true],
  [/(^|\.)coinbase\.com$/, "Coinbase", false],
  [/(^|\.)expressvpn\.com$/, "ExpressVPN", false],
  [/(^|\.)popmart\.com$/, "POP MART", false],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube", false],
  [/(^|\.)instagram\.com$/, "Instagram", false],
  [/(^|\.)(twitter|x)\.com$/, "X", false],
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

async function resolveImages(files, width = 256, height = null) {
  const out = {};
  const list = [...new Set(files.filter(Boolean))];
  for (let i = 0; i < list.length; i += 50) {
    const batch = list.slice(i, i + 50);
    const d = await api({
      action: "query", prop: "imageinfo", iiprop: "url", iiurlwidth: String(width), ...(height && { iiurlheight: String(height) }),
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

async function download(url, dest, { force = false } = {}) {
  if (!force && (await exists(dest))) return true;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return false;
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

// Lossless WebP is about a quarter the size of the wiki's PNGs with identical
// pixels. Needs cwebp and gif2webp (the "webp" package in apt and Homebrew);
// without them images keep their original format.
const run = promisify(execFile);
let webpTools;
const hasWebp = () => (webpTools ??= Promise.all([run("cwebp", ["-version"]), run("gif2webp", ["-version"])]).then(() => true, () => false));

// Saves a wiki image under img/ and returns its path, or null if the download
// failed. An existing WebP is reused, so each image is fetched once. suffix
// keeps different sizes of the same file apart.
async function localImage(url, file, suffix = "") {
  const base = "img/" + slug(file.replace(/\.\w+$/, "")) + suffix;
  const orig = base + (path.extname(new URL(url).pathname) || ".png");
  if (!(await hasWebp())) return (await download(url, path.join(ROOT, orig))) ? orig : null;

  const webp = base + ".webp";
  if (await exists(path.join(ROOT, webp))) return webp;
  // Always fetch fresh: a leftover original may be an older, larger thumbnail.
  if (!(await download(url, path.join(ROOT, orig), { force: true }))) return null;
  const [src, dest] = [path.join(ROOT, orig), path.join(ROOT, webp)];
  if (orig.endsWith(".gif")) await run("gif2webp", ["-quiet", "-m", "6", src, "-o", dest]);
  else await run("cwebp", ["-quiet", "-lossless", "-z", "9", src, "-o", dest]);
  await unlink(src);
  return webp;
}

// Deletes files in img/ that no item uses any more (old formats, removed items).
async function pruneImages(items) {
  const used = new Set(items.flatMap((i) => [i.image, i.imageLarge, i.imageWide]));
  for (const f of await readdir(path.join(ROOT, "img"))) {
    if (!used.has("img/" + f)) await unlink(path.join(ROOT, "img", f));
  }
}

// Compare names ignoring case, spacing and punctuation, but keep letters in any
// script so e.g. "Ñ Title" and "^>.<^ Title" stay distinct.
const normName = (s) => s.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// One entry per item: an item listed under several sources (e.g. a broadcast
// drop that was also a Coinbase reward) becomes one item whose most recent
// source is primary and the rest are listed in alsoFrom.
function mergeDuplicates(items) {
  // Ongoing offers count as the most recent way to get an item.
  const date = (i) => (i.ongoing ? "9999" : i.period?.start || i.period?.end || "");
  const groups = new Map();
  for (const i of items) {
    const k = i.type + "§" + normName(i.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  const out = [];
  for (const ways of groups.values()) {
    if (ways.length === 1) { out.push({ ...ways[0], alsoFrom: [] }); continue; }
    // Stable sort keeps wiki order for undated ways.
    const sorted = [...ways].sort((a, b) => date(b).localeCompare(date(a)));
    const [primary, ...rest] = sorted;
    const periods = ways.map((w) => w.period).filter(Boolean);
    const seen = new Set();
    out.push({
      ...primary,
      image: primary.image || rest.find((w) => w.image)?.image || null,
      imageLarge: primary.imageLarge || rest.find((w) => w.imageLarge)?.imageLarge || null,
      imageWide: primary.imageWide || rest.find((w) => w.imageWide)?.imageWide || null,
      // A null end means no end date is known yet, so it counts as the latest.
      period: periods.sort((a, b) => (b.end || "9999").localeCompare(a.end || "9999"))[0] || null,
      ongoing: ways.find((w) => w.ongoing)?.ongoing || null,
      maybeActive: ways.some((w) => w.maybeActive),
      sources: ways.flatMap((w) => w.sources).filter((s) => !seen.has(s.url) && seen.add(s.url)),
      // Known before (null) if any way was; otherwise the earliest date.
      firstSeen: ways.some((w) => w.firstSeen == null) ? null : ways.map((w) => w.firstSeen).sort()[0],
      // A tag that applies to only some ways is "partial": the item can still be had elsewhere.
      regions: [...new Map(ways.flatMap((w) => w.regions).map((t) => [t.code, t])).values()]
        .map((t) => ({ ...t, partial: !ways.every((w) => w.regions.some((r) => r.code === t.code)) })),
      alsoFrom: rest.map((w) => ({
        category: w.category, group: w.group, subgroup: w.subgroup, details: w.details, period: w.period, regions: w.regions,
      })),
    });
  }
  // Stable, readable ids for share links (?item=slime-mosh-buddy).
  const used = new Set();
  return out.map((i, n) => {
    const base = i.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "item";
    let slug = base;
    for (let k = 2; used.has(slug); k++) slug = `${base}-${k}`;
    used.add(slug);
    return { ...i, id: n + 1, slug };
  });
}

// When each item first appeared on the site, carried forward from the previous
// data/items.js. Items from the very first build have no known date (null).
async function loadFirstSeen() {
  let prev = [];
  try {
    const src = await readFile(path.join(ROOT, "data/items.js"), "utf8");
    prev = JSON.parse(src.replace(/^window\.VAL_DROPS\s*=\s*/, "").replace(/;\s*$/, "")).items;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  const keyOf = (i) => [i.category, i.group, i.subgroup, i.name].join("§");
  // Fallback match on type + name so a renamed wiki section doesn't make old items look new.
  const nameOf = (i) => i.type + "§" + normName(i.name);
  const byKey = new Map(prev.map((i) => [keyOf(i), i.firstSeen ?? null]));
  const byName = new Map();
  for (const i of prev) if (!byName.has(nameOf(i)) || i.firstSeen == null) byName.set(nameOf(i), i.firstSeen ?? null);
  return (it) => {
    if (byKey.has(keyOf(it))) return byKey.get(keyOf(it));
    if (byName.has(nameOf(it))) return byName.get(nameOf(it));
    return prev.length ? today : null;
  };
}

async function main() {
  console.log("Fetching wiki pages…");
  // A dedicated page that suddenly yields nothing means the wiki renamed or
  // restructured it; fail rather than quietly publish without it.
  const need = async (name, p) => {
    const items = await p;
    if (!items.length) throw new Error(`No items parsed from ${name}. The wiki page may have moved or changed layout.`);
    return items;
  };
  const raw = [
    ...(await need("Broadcast Rewards", parseBroadcastDrops())),
    ...(await need("Prime Gaming Drops", parsePrimeGaming())),
    ...(await need("VALORANT X PS+ Bundles", parsePSPlus())),
    ...(await need("Closed Beta", parseClosedBeta())),
    ...(await need("Pick'Ems", parsePickEms())),
    ...(await Promise.all(EVENT_PAGES.map((p) => need(p, parseEventPage(p))))).flat(),
  ].filter((it) => it.name && Object.values(CATEGORY_TYPES).includes(it.type));

  // Type pages fill gaps; an item already listed by a dedicated page in the same
  // category just contributes its extra citations.
  // Pages don't agree on the type suffix ("Claw and Order" vs "Claw and Order Spray"), so match without it.
  const gapKey = (it) => [it.category, it.type, normName(it.name.replace(/\s+(Spray|Buddy|Card|Title)$/i, ""))].join("§");
  const byName = new Map(raw.map((it) => [gapKey(it), it]));
  const typeItems = (await Promise.all(TYPE_PAGES.map(parseTypePage))).flat();
  for (const it of typeItems) {
    if (!it.name) continue;
    const dup = byName.get(gapKey(it));
    if (dup) { dup.refs.push(...it.refs); continue; }
    if (it.category === "Broadcast Drops") it.group = "Other broadcast drops";
    if (it.category === "Prime Gaming") it.group = "Prime Gaming Drops (2020–2024)";
    raw.push(it);
  }

  const curated = JSON.parse(await readFile(path.join(ROOT, "data/curated.json"), "utf8"));
  for (const it of curated.items) raw.push({ details: [], wikiLinks: [], subgroup: null, title: null, ...it, curated: true });
  // Dates the wiki doesn't give, each with its source. They apply to every listing of the item.
  for (const d of curated.dates) {
    const hits = raw.filter((it) => it.type === d.type && normName(it.name) === normName(d.name));
    if (!hits.length) console.warn(`  ! curated date for ${d.name} matches no item`);
    for (const it of hits) {
      if (d.period) it.period = d.period;
      if (d.ongoing) it.ongoing = d.ongoing;
      it.details = [...it.details, d.detail];
      it.refs.push(...d.refs);
    }
  }

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

  const firstSeen = await loadFirstSeen();
  const files = [...merged.values()].map((i) => i.file);
  const images = await resolveImages(files, ...THUMB_BOX);
  // Larger copies for the item detail view, only loaded when it opens.
  const large = await resolveImages(files, 600);
  // Player cards also have a wide banner version ("X Card Wide.png").
  const wideName = (f) => (f && / Large\.\w+$/.test(f) ? f.replace(/ Large(\.\w+)$/, " Wide$1") : null);
  const wide = await resolveImages(files.map(wideName), 900);
  const imgDir = path.join(ROOT, "img");
  await mkdir(imgDir, { recursive: true });

  // Local copy when possible; the wiki URL if downloads are off or fail.
  const save = async (url, file, suffix) => (url && !SKIP_IMAGES && (await localImage(url, file, suffix))) || url || null;
  const items = [];
  let n = 0;
  for (const it of merged.values()) {
    const img = it.file && images[it.file];
    let image = null;
    let imageLarge = null;
    if (img) {
      image = await save(img.thumb, it.file);
      // Small originals come back at the same URL for both sizes, so reuse the thumbnail.
      const big = large[it.file]?.thumb;
      imageLarge = big === img.thumb ? image : await save(big, it.file, "_600");
    } else if (it.file && !it.curated) {
      console.warn("  ! no image for", it.file);
    }
    const wideFile = wideName(it.file);
    const imageWide = await save(wide[wideFile]?.thumb, wideFile);
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
      imageLarge,
      imageWide,
      details: it.detailRows.filter((r) => r.length),
      ...(() => {
        const { period, openCode } = itemPeriod(it.detailRows);
        return {
          // Parsers that know the window better than the detail text (PS+ bundles) set it directly.
          period: it.period || period,
          ongoing: it.ongoing || null,
          // A public code whose expiry the wiki lists as unknown may still work.
          maybeActive: it.category === "Code Redemption" && openCode,
        };
      })(),
      sources,
      firstSeen: firstSeen(it),
      codes: it.category === "Code Redemption" ? parseCodes(it.detailRows) : null,
      regions: regionTags(it),
    });
    if (n % 50 === 0) process.stdout.write(`  ${n} items\r`);
  }

  const out = {
    generated: new Date().toISOString(),
    primarySource: { label: "VALORANT Wiki", url: WIKI },
    items: mergeDuplicates(items),
  };
  if (!SKIP_IMAGES) await pruneImages(out.items);
  await writeFile(path.join(ROOT, "data/items.js"), "window.VAL_DROPS = " + JSON.stringify(out, null, 1) + ";\n");
  const counts = out.items.reduce((a, i) => ((a[i.category] = (a[i.category] || 0) + 1), a), {});
  console.log(`Wrote ${out.items.length} items (${items.length - out.items.length} duplicates merged)`, counts);
}

main().catch((e) => { console.error(e); process.exit(1); });
