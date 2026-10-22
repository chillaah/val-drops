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

  const state = { q: "", cat: null, type: null };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const haystack = new Map(items.map((i) => [i, [
    i.name, i.type, i.category, i.group, i.subgroup,
    ...i.details.flat().map((d) => d.value),
  ].join(" ").toLowerCase()]));

  function matches(i, ignore) {
    if (ignore !== "cat" && state.cat && i.category !== state.cat) return false;
    if (ignore !== "type" && state.type && i.type !== state.type) return false;
    if (state.q && !state.q.split(/\s+/).every((w) => haystack.get(i).includes(w))) return false;
    return true;
  }

  function chips(el, values, key) {
    const counts = (v) => items.filter((i) => matches(i, key) && (v === null || (key === "cat" ? i.category : i.type) === v)).length;
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

  // Wiki bullet lists arrive flattened as "• a • b"; put each on its own line.
  const bullets = (v) => esc(v).split(/\s*• /).filter(Boolean).map((x, k, a) => (a.length > 1 ? "• " : "") + x).join("<br>");

  function card(i) {
    const details = i.details.map((row) =>
      `<div>${row.map((d) => (d.label ? `<b>${esc(d.label)}:</b> ` : "") + bullets(d.value)).join("<br>")}</div>`
    ).join("");
    const sources = i.sources.map((s) =>
      `<a href="${esc(s.url)}" target="_blank" rel="noopener">${s.official ? '<span class="off">✓</span> ' : ""}${esc(s.label)}</a>`
    ).join("");
    return `<article class="card">${thumb(i)}<div class="body">
      <p class="name">${esc(i.name)}</p><span class="type">${esc(i.type)}</span>
      ${details ? `<div class="details">${details}</div>` : ""}
      <div class="src">${sources}</div></div></article>`;
  }

  function render() {
    chips($("#cats"), CATEGORIES.map((c) => c[0]), "cat");
    chips($("#types"), TYPES.filter((t) => items.some((i) => i.type === t)), "type");
    const visible = items.filter((i) => matches(i));
    let html = "";
    for (const [cat, blurb] of CATEGORIES) {
      const inCat = visible.filter((i) => i.category === cat);
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

  $("#q").addEventListener("input", (e) => { state.q = e.target.value.trim().toLowerCase(); render(); });
  $("#meta").textContent = `${items.length} items · data refreshed ${new Date(generated).toLocaleDateString(undefined, { dateStyle: "medium" })}`;
  render();
})();
