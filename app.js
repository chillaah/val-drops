(() => {
  const { items, generated } = window.VAL_DROPS;

  const CATEGORIES = [
    ["Broadcast Drops", "Rewards for watching official VCT broadcasts, co-streams and partner streams with a linked Riot account (Twitch Drops, Shotcall extension)."],
    ["Pick'Ems", "Rewards for taking part in the official VCT Pick'Ems bracket predictions."],
    ["Events & Partnerships", "Web events like Alpha vs. Omega and Frag or Die, brand promos (Coinbase, ExpressVPN, Verizon, Xbox), merch codes, watch parties and Shotcall."],
    ["Code Redemption", "Items unlocked with public codes Riot announced, redeemable at the Riot redemption site."],
    ["Prime Gaming", "Monthly Prime Gaming (Amazon) drops, discontinued in March 2024."],
    ["PlayStation Plus", "Free rotating bundles for PlayStation Plus members on PS5."],
    ["Pro Play", "Items given to pro players and staff for competing in or winning Riot-run tournaments."],
  ];
  const TYPES = ["Title", "Player Card", "Gun Buddy", "Spray", "Gun Skin"];

  const SORTS = [["group", "Group by source"], ["newest", "Newest first"]];
  const RECENT_DAYS = 30;

  const params = new URLSearchParams(location.search);
  const state = { q: "", cat: null, type: null, sort: params.get("sort") === "newest" ? "newest" : "group" };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const haystack = new Map(items.map((i) => [i, [
    i.name, i.type, i.category, i.group, i.subgroup,
    ...i.details.flat().map((d) => d.value),
    ...i.alsoFrom.flatMap((a) => [a.category, a.group, a.subgroup, ...a.details.flat().map((d) => d.value)]),
  ].join(" ").toLowerCase()]));

  const categoriesOf = (i) => [i.category, ...i.alsoFrom.map((a) => a.category)];

  function matches(i, ignore) {
    if (ignore !== "cat" && state.cat && !categoriesOf(i).includes(state.cat)) return false;
    if (ignore !== "type" && state.type && i.type !== state.type) return false;
    if (state.q && !state.q.split(/\s+/).every((w) => haystack.get(i).includes(w))) return false;
    return true;
  }

  function chips(el, values, key) {
    const counts = (v) => items.filter((i) => matches(i, key) && (v === null || (key === "cat" ? categoriesOf(i).includes(v) : i.type === v))).length;
    el.innerHTML = [[null, "All"], ...values.map((v) => [v, v])].map(([v, label]) =>
      `<button class="chip" data-v="${esc(v ?? "")}" aria-pressed="${state[key] === v}">${esc(label)}<small>${counts(v)}</small></button>`
    ).join("");
    el.onclick = (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      state[key] = b.dataset.v || null;
      render();
    };
  }

  function thumb(i) {
    if (i.type === "Title") return `<div class="thumb"><div class="ptitle">${esc(i.title || i.name.replace(/ Title$/, ""))}</div></div>`;
    if (!i.image) return `<div class="thumb"></div>`;
    const cls = i.type === "Player Card" ? "thumb card-img" : "thumb";
    return `<div class="${cls}"><img src="${esc(i.image)}" alt="${esc(i.name)}" loading="lazy"></div>`;
  }

  // ---------- claim status ----------
  // Wiki dates are Pacific time, so compare against today's date in PT.
  const ptDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
  const TODAY = ptDate(new Date());
  const dayNum = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
  const daysFrom = (s) => dayNum(s) - dayNum(TODAY);
  const fmtDay = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)))
    .toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

  function status(i) {
    const p = i.period;
    if (p && p.end >= TODAY && (!p.start || p.start <= TODAY)) return "active";
    if (p && p.start && p.start > TODAY) return "upcoming";
    if (i.ongoing) return "active";
    if (i.maybeActive) return "maybe";
    return null;
  }

  function statusLabel(i) {
    const st = status(i);
    if (st === "active" && i.period && i.period.end >= TODAY && (!i.period.start || i.period.start <= TODAY)) {
      const n = daysFrom(i.period.end);
      return n === 0 ? "Ends today" : n === 1 ? "Ends tomorrow" : `Ends in ${n} days · ${fmtDay(i.period.end)}`;
    }
    if (st === "active") return "Available now · no end date";
    if (st === "upcoming") {
      const n = daysFrom(i.period.start);
      return n === 1 ? `Starts tomorrow · ${fmtDay(i.period.start)}` : `Starts in ${n} days · ${fmtDay(i.period.start)}`;
    }
    if (st === "maybe") return "Code may still work";
    return null;
  }

  function howToClaim(i) {
    if (i.category === "Code Redemption") {
      const codes = i.details.flat().filter((d) => d.label === "Code").flatMap((d) => d.value.split(/\s*•\s*/)).filter(Boolean);
      const code = codes.reverse().find((c) => !c.endsWith("*")) || codes[0];
      return code
        ? `Redeem <code>${esc(code)}</code> at <a href="https://shop.riotgames.com/redeem/" target="_blank" rel="noopener">shop.riotgames.com/redeem</a>.`
        : `Redeem at <a href="https://shop.riotgames.com/redeem/" target="_blank" rel="noopener">shop.riotgames.com/redeem</a>.`;
    }
    if (i.category === "Broadcast Drops") {
      if (/shotcall/i.test(i.subgroup || "")) return "Make predictions with the Shotcall extension on the official VALORANT Twitch stream.";
      if (/co-?stream/i.test(i.subgroup || "")) return "Watch eligible co-streamers on Twitch with your Riot account linked.";
      return "Link your Riot account to Twitch, then watch the official broadcast during the eligible dates.";
    }
    if (i.category === "PlayStation Plus") return "With PlayStation Plus, claim the VALORANT bundle in the PlayStation Store, then log in to VALORANT on PS5.";
    return i.ongoing?.note ? esc(i.ongoing.note) : "";
  }

  // Wiki bullet lists arrive flattened as "• a • b"; put each on its own line.
  const bullets = (v) => esc(v).split(/\s*• /).filter(Boolean).map((x, k, a) => (a.length > 1 ? "• " : "") + x).join("<br>");

  // The date an item belongs to: when its claim window opened, or closed if that's all we know.
  const itemDate = (i) => i.period?.start || i.period?.end || i.ongoing?.since || null;
  const isRecent = (i) => i.firstSeen && daysFrom(i.firstSeen) > -RECENT_DAYS;

  function card(i, { claim = false, context = false } = {}) {
    const details = i.details.map((row) =>
      `<div>${row.map((d) => (d.label ? `<b>${esc(d.label)}:</b> ` : "") + bullets(d.value)).join("<br>")}</div>`
    ).join("");
    const also = i.alsoFrom.map((a) => {
      const where = [a.category, a.group !== a.category ? a.group : null, a.subgroup].filter(Boolean).join(" · ");
      const info = a.details.map((row) => row.map((d) => (d.label ? `<b>${esc(d.label)}:</b> ` : "") + bullets(d.value)).join("<br>")).join("<br>");
      return `<div><span class="where">${esc(where)}</span>${info ? `<br>${info}` : ""}</div>`;
    }).join("");
    const sources = i.sources.map((s) =>
      `<a href="${esc(s.url)}" target="_blank" rel="noopener">${s.official ? '<span class="off">✓</span> ' : ""}${esc(s.label)}</a>`
    ).join("");
    const st = status(i);
    const label = statusLabel(i);
    const how = claim ? howToClaim(i) : "";
    return `<article class="card${st ? " is-" + st : ""}">${thumb(i)}<div class="body">
      ${label ? `<span class="status ${st}">${esc(label)}</span>` : ""}
      ${isRecent(i) ? `<span class="added">New · added ${esc(fmtDay(i.firstSeen))}</span>` : ""}
      <p class="name">${esc(i.name)}</p><span class="type">${esc(i.type)}</span>
      ${context ? `<p class="ctx">${esc([i.category, i.group !== i.category ? i.group : null, i.subgroup].filter(Boolean).join(" · "))}</p>` : ""}
      ${how ? `<p class="how"><b>How to claim:</b> ${how}</p>` : ""}
      ${details ? `<div class="details">${details}</div>` : ""}
      ${also ? `<div class="also"><p class="also-h">Also from</p>${also}</div>` : ""}
      <div class="src">${sources}</div></div></article>`;
  }

  function nowSection(visible) {
    const endOf = (i) => (i.period && i.period.end >= TODAY ? i.period.end : "9999");
    const active = visible.filter((i) => status(i) === "active").sort((a, b) => endOf(a).localeCompare(endOf(b)));
    const upcoming = visible.filter((i) => status(i) === "upcoming")
      .sort((a, b) => a.period.start.localeCompare(b.period.start));
    const maybe = visible.filter((i) => status(i) === "maybe");
    if (!active.length && !upcoming.length && !maybe.length) return "";
    const grid = (list) => `<div class="grid">${list.map((i) => card(i, { claim: true })).join("")}</div>`;
    let html = `<section class="cat now" id="now"><h2>Claimable now</h2>
      <p>Rewards you can still get, soonest-ending first. Dates are in Pacific time and follow the wiki, so check the linked source before relying on them.</p>`;
    html += active.length ? grid(active) : `<p class="note">Nothing claimable right now.</p>`;
    if (upcoming.length) html += `<div class="group"><h3>Coming soon</h3>${grid(upcoming)}</div>`;
    if (maybe.length) html += `<div class="group"><h3>Codes that may still work</h3>
      <p class="note">Public codes the wiki lists without an expiry date. They might still redeem.</p>${grid(maybe)}</div>`;
    return html + `</section>`;
  }

  function recentSection(visible) {
    const recent = visible.filter(isRecent).sort((a, b) => b.firstSeen.localeCompare(a.firstSeen));
    if (!recent.length) return "";
    return `<section class="cat" id="recent"><h2>Recently added</h2>
      <p>New on this site in the last ${RECENT_DAYS} days, newest first.</p>
      <div class="grid">${recent.map((i) => card(i, { context: true })).join("")}</div></section>`;
  }

  // Timeline view: items grouped by the month of their own date, newest first.
  function timeline(visible) {
    const months = new Map();
    for (const i of [...visible].sort((a, b) => (itemDate(b) || "").localeCompare(itemDate(a) || ""))) {
      const d = itemDate(i);
      const k = d ? d.slice(0, 7) : "undated";
      if (!months.has(k)) months.set(k, []);
      months.get(k).push(i);
    }
    let html = "";
    for (const [k, list] of months) {
      const title = k === "undated"
        ? "Date not listed"
        : new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
      html += `<section class="cat month"><h2>${esc(title)}</h2>`;
      if (k === "undated") html += `<p>The wiki doesn't give a date for these (most Pick'Ems, pro play and some promos).</p>`;
      html += `<div class="grid">${list.map((i) => card(i, { context: true })).join("")}</div></section>`;
    }
    return html;
  }

  function sortChips() {
    const el = $("#sort");
    el.innerHTML = `<span class="lbl">Sort:</span>` + SORTS.map(([v, label]) =>
      `<button class="chip" data-v="${v}" aria-pressed="${state.sort === v}">${esc(label)}</button>`).join("");
    el.onclick = (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      state.sort = b.dataset.v;
      const u = new URL(location.href);
      if (state.sort === "newest") u.searchParams.set("sort", "newest"); else u.searchParams.delete("sort");
      history.replaceState(null, "", u);
      render();
    };
  }

  function render() {
    chips($("#cats"), CATEGORIES.map((c) => c[0]), "cat");
    chips($("#types"), TYPES.filter((t) => items.some((i) => i.type === t)), "type");
    const visible = items.filter((i) => matches(i));
    sortChips();
    let html = nowSection(visible) + recentSection(visible);
    if (state.sort === "newest") {
      $("#list").innerHTML = html + (timeline(visible) || `<p class="empty">No items match your filters.</p>`);
      return;
    }
    // With a source filter on, show items under the way that matches it.
    const placed = visible.map((i) => {
      if (!state.cat || i.category === state.cat) return i;
      const a = i.alsoFrom.find((x) => x.category === state.cat);
      return { ...i, category: a.category, group: a.group, subgroup: a.subgroup, groupNote: null };
    });
    for (const [cat, blurb] of CATEGORIES) {
      const inCat = placed.filter((i) => i.category === cat);
      if (!inCat.length) continue;
      html += `<section class="cat"><h2>${esc(cat)}</h2><p>${esc(blurb)}</p>`;
      const groups = [...new Set(inCat.map((i) => i.group))];
      for (const g of groups) {
        const gi = inCat.filter((i) => i.group === g);
        const showHead = g !== cat;
        html += `<div class="group">${showHead ? `<h3>${esc(g)}</h3>` : ""}`;
        if (gi[0].groupNote) html += `<p class="note">${esc(gi[0].groupNote)}</p>`;
        const subs = [...new Set(gi.map((i) => i.subgroup))];
        for (const s of subs) {
          if (s) html += `<div class="sub">${esc(s)}</div>`;
          html += `<div class="grid">${gi.filter((i) => i.subgroup === s).map(card).join("")}</div>`;
        }
        html += `</div>`;
      }
      html += `</section>`;
    }
    $("#list").innerHTML = html || `<p class="empty">No items match your filters.</p>`;
  }

  // ?q= pre-fills the search (used by links posted to Discord).
  const initial = params.get("q");
  if (initial) { $("#q").value = initial; state.q = initial.trim().toLowerCase(); }
  $("#q").addEventListener("input", (e) => { state.q = e.target.value.trim().toLowerCase(); render(); });
  const live = items.filter((i) => status(i) === "active").length;
  $("#meta").innerHTML = `${items.length} items · ${live ? `<a href="#now">${live} claimable now</a> · ` : ""}data refreshed ${esc(new Date(generated).toLocaleDateString(undefined, { dateStyle: "medium" }))}`;
  render();
})();
