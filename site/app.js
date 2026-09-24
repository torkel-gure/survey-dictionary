"use strict";
/* Survey Dictionary: static front end.
   Data (built by build_data.R) lives in data/: meta.json.gz, index.json.gz, q/<shard>.json.gz */

// Where the data files live: set in config.js (e.g. a GCS bucket URL); defaults to ./data/
const DATA = window.SD_DATA_URL || "data/";
const PAGE = 100;
const MISSING_RE = /(don'?t know|\bdk\b|refus|no answer|\bn\/?a\b|not applicable|inap|missing|can'?t choose|decline|not asked|no reply|skipped|dk\/na|dont know)/i;

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => n == null ? "–" : Number(n).toLocaleString("en-US");

const S = {
  meta: null, idx: null, hay: null,
  hits: [], shown: 0, active: null,
  applied: { prog: "", sort: "rel" },   // filter/sort in effect (the selects only count after "Apply filter")
  shards: new Map(),
  occ: [],            // occurrences of the active question
  sel: [],            // selected occurrence keys (distribution panel)
  occFilter: "", occSort: ["prog", 1],
  excludeMissing: false,
};

/* ---------- data loading ---------- */
// meta is always fetched fresh; its build stamp versions every other file so a rebuild
// is picked up at once despite browser / GCS caching.
let VERSION = "";
async function loadGz(path, opts) {
  const r = await fetch(DATA + path + (VERSION ? "?v=" + encodeURIComponent(VERSION) : ""), opts);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {       // gzip magic: decompress ourselves
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(new TextDecoder().decode(buf)); // server already decompressed it
}

function getShard(s) {
  if (!S.shards.has(s)) S.shards.set(s, loadGz(`q/${s}.json.gz`));
  return S.shards.get(s);
}

/* ---------- helpers ---------- */
const fileInfo = fid => {
  const [p, c, y] = S.meta.files[fid];
  return { prog: S.meta.progs[p][0], progName: S.meta.progs[p][1], iso: S.meta.countries[c][0], country: S.meta.countries[c][1], year: y };
};
const occKey = o => `${o[0]}|${o[1]}`;

function highlight(text, terms) {
  let h = esc(text);
  for (const t of terms) {
    if (t.length < 2) continue;
    const re = new RegExp(`(${esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    h = h.replace(re, "<mark>$1</mark>");
  }
  return h;
}

/* ---------- search ---------- */
function runSearch() {
  const q = $("#q").value.trim().toLowerCase();
  const { prog, sort } = S.applied;
  const { idx } = S;
  const terms = q.split(/\s+/).filter(Boolean);
  const pi = prog === "" ? -1 : +prog;
  const hits = [];
  for (let i = 0; i < idx.label.length; i++) {
    if (pi >= 0 && !idx.progs[i].includes(pi)) continue;
    const h = S.hay[i];
    let ok = true;
    for (const t of terms) if (!h.includes(t)) { ok = false; break; }
    if (ok) hits.push(i);
  }
  if (sort === "n") hits.sort((a, b) => idx.n[b] - idx.n[a]);
  else if (sort === "nc") hits.sort((a, b) => idx.nc[b] - idx.nc[a] || idx.n[b] - idx.n[a]);
  else if (q) {
    const score = i => {
      const l = idx.label[i].toLowerCase();
      return (l.includes(q) ? 2 : 0) + (l.startsWith(q) ? 1 : 0);
    };
    const sc = new Map(hits.map(i => [i, score(i)]));
    hits.sort((a, b) => sc.get(b) - sc.get(a) || idx.nc[b] - idx.nc[a] || idx.n[b] - idx.n[a]);
  }
  S.hits = hits; S.shown = 0; S.terms = terms;
  $("#results").innerHTML = "";
  const where = prog ? ` in ${S.meta.progs[+prog][0]}` : "";
  $("#resultsHead").textContent = `${fmt(hits.length)} question${hits.length === 1 ? "" : "s"}${q ? " match" : ""}${where}`;
  renderMore();
}

/* ---------- filters (applied with the button) ---------- */
const SORT_LABELS = { rel: "Best match", n: "Most datasets", nc: "Most countries" };
const isDirty = () => $("#prog").value !== S.applied.prog || $("#sort").value !== S.applied.sort;

function applyFilters() {
  S.applied = { prog: $("#prog").value, sort: $("#sort").value };
  runSearch(); updateHash(); renderActive();
}

function renderActive() {
  const dirty = isDirty();
  $("#apply").disabled = !dirty;
  $("#filters").classList.toggle("dirty", dirty);
  const { prog, sort } = S.applied;
  const chips = [];
  if (prog) {
    const [code, name] = S.meta.progs[+prog];
    chips.push(`<span class="fchip">Programme: <b>${esc(code)}</b> <span class="muted">${esc(name)}</span><button type="button" data-clear="prog" aria-label="Remove programme filter">×</button></span>`);
  }
  if (sort !== "rel") chips.push(`<span class="fchip">Sorted by: <b>${SORT_LABELS[sort]}</b><button type="button" data-clear="sort" aria-label="Reset sorting">×</button></span>`);
  $("#active").innerHTML =
    (chips.length ? `<span>Active:</span>${chips.join("")}` : "") +
    (dirty ? `<span class="pending">Changes not applied yet: click “Apply filter”</span>` : "");
}

function renderMore() {
  const { idx } = S;
  const slice = S.hits.slice(S.shown, S.shown + PAGE);
  const html = slice.map(i => {
    const progs = idx.progs[i].map(p => S.meta.progs[p][0]).join(", ");
    const yrs = idx.y0[i] === idx.y1[i] ? idx.y0[i] : `${idx.y0[i]}–${idx.y1[i]}`;
    return `<li data-g="${i}" class="${i === S.active ? "active" : ""}" tabindex="0">
      <div class="lbl">${highlight(idx.label[i], S.terms)}</div>
      <div class="meta">${fmt(idx.n[i])} datasets · ${idx.nc[i]} ${idx.nc[i] === 1 ? "country" : "countries"} · ${yrs} · ${esc(progs)}</div></li>`;
  }).join("");
  $("#results").insertAdjacentHTML("beforeend", html);
  S.shown += slice.length;
  const total = S.hits.length, left = total - S.shown;
  $("#more").hidden = left <= 0;
  $("#more").textContent = `Show ${fmt(Math.min(PAGE, left))} more (${fmt(S.shown)} of ${fmt(total)} shown)`;
  $("#allShown").hidden = left > 0;
  $("#allShown").textContent = total === 0
    ? "No questions match. Try fewer or shorter words, or remove the programme filter."
    : `All ${fmt(total)} result${total === 1 ? "" : "s"} shown`;
}

/* ---------- question detail ---------- */
async function openQuestion(g, { keepSel = false } = {}) {
  S.active = g;
  document.querySelectorAll("#results li.active").forEach(li => li.classList.remove("active"));
  document.querySelector(`#results li[data-g="${g}"]`)?.classList.add("active");
  updateHash();
  const det = $("#detail");
  det.innerHTML = `<div class="loading">Loading question…</div>`;
  let shard;
  try { shard = await getShard(S.idx.shard[g]); }
  catch (e) { det.innerHTML = `<div class="loading err">Could not load data: ${esc(e.message)}</div>`; return; }
  if (S.active !== g) return;
  S.occ = shard[g].map(o => ({ o, key: occKey(o), ...fileInfo(o[0]) }));
  if (!keepSel) S.sel = [];
  S.occFilter = "";
  renderDetail();
}

function renderDetail() {
  const g = S.active, { idx } = S;
  const occ = S.occ;
  const countries = new Set(occ.map(r => r.iso));
  const years = [...new Set(occ.map(r => r.year))].sort();
  const progs = [...new Set(occ.map(r => r.prog))].sort();
  const variants = new Map();
  for (const r of occ) { const l = r.o[2] || idx.label[g]; variants.set(l, (variants.get(l) || 0) + 1); }
  const vlist = [...variants].sort((a, b) => b[1] - a[1]);
  const varnames = new Map();
  for (const r of occ) varnames.set(r.o[1], (varnames.get(r.o[1]) || 0) + 1);

  $("#detail").innerHTML = `
    <div class="card">
      <h2 class="qtitle">${esc(idx.label[g])}</h2>
      <div class="kpis">
        <div class="kpi"><b>${fmt(occ.length)}</b><span>datasets</span></div>
        <div class="kpi"><b>${countries.size}</b><span>countries</span></div>
        <div class="kpi"><b>${years[0]}${years.length > 1 ? "–" + years[years.length - 1] : ""}</b><span>${years.length} survey years</span></div>
        <div class="kpi"><b>${progs.length}</b><span>programmes</span></div>
      </div>
      <div class="chips">${[...varnames].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([v, n]) => `<span class="chip" title="${n} datasets"><code>${esc(v)}</code></span>`).join("")}</div>
      ${vlist.length > 1 ? `<details class="variants"><summary>${vlist.length} label variants in this group</summary><ul>${vlist.slice(0, 50).map(([l, n]) => `<li>${esc(l)} <span class="muted">(${n})</span></li>`).join("")}</ul></details>` : ""}
    </div>

    <div class="card">
      <h3>Where it was asked <span class="muted" style="font-weight:400">Select a cell to view its distribution</span></h3>
      <div class="cov-wrap">${coverageTable(occ, years)}</div>
      <div class="legend"><span><i style="background:var(--cell-1)"></i>1 dataset</span><span><i style="background:var(--cell-2)"></i>2</span><span><i style="background:var(--cell-3)"></i>3 or more</span><span><i style="background:var(--surface-2)"></i>not asked</span></div>
    </div>

    <div class="card">
      <h3>All datasets <span class="spacer"></span>
        <button class="btn small" id="selAll">Show distributions for the first 12 rows</button></h3>
      <div class="tools"><input id="occFilter" type="search" placeholder="Filter by country, programme, year or variable…" value="${esc(S.occFilter)}"></div>
      <div class="occ-wrap" id="occTable"></div>
    </div>

    <div class="card" id="distCard"></div>`;
  renderOccTable();
  renderDists();
}

function coverageTable(occ, years) {
  const byC = new Map();
  for (const r of occ) {
    if (!byC.has(r.iso)) byC.set(r.iso, { name: r.country, cells: new Map() });
    const cells = byC.get(r.iso).cells;
    if (!cells.has(r.year)) cells.set(r.year, []);
    cells.get(r.year).push(r);
  }
  const selSet = new Set(S.sel);
  const rows = [...byC.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const head = `<thead><tr><th></th>${years.map(y => `<th>${esc(y)}</th>`).join("")}</tr></thead>`;
  const body = rows.map(([iso, c]) => `<tr><th title="${esc(c.name)}">${esc(c.name)}</th>${years.map(y => {
    const list = c.cells.get(y);
    if (!list) return "<td></td>";
    const cls = "c" + Math.min(3, list.length) + (list.some(r => selSet.has(r.key)) ? " sel" : "");
    return `<td class="${cls}" data-iso="${iso}" data-year="${esc(y)}"></td>`;
  }).join("")}</tr>`).join("");
  return `<table class="cov">${head}<tbody>${body}</tbody></table>`;
}

function filteredOcc() {
  const f = S.occFilter.toLowerCase().trim();
  let rows = S.occ;
  if (f) {
    const terms = f.split(/\s+/);
    rows = rows.filter(r => {
      const h = `${r.prog} ${r.progName} ${r.country} ${r.iso} ${r.year} ${r.o[1]} ${r.o[2] || ""}`.toLowerCase();
      return terms.every(t => h.includes(t));
    });
  }
  const [k, dir] = S.occSort;
  const val = r => k === "n" ? (r.o[3] ?? -1) : k === "var" ? r.o[1] : r[k];
  const ties = r => `${r.prog}|${r.country}|${r.year}`;
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    const c = typeof x === "number" ? x - y : String(x).localeCompare(String(y));
    return c * dir || ties(a).localeCompare(ties(b));
  });
}

function renderOccTable() {
  const rows = filteredOcc();
  const selSet = new Set(S.sel);
  const cols = [["prog", "Programme"], ["country", "Country"], ["year", "Year"], ["var", "Variable"], ["n", "N valid"]];
  const arrow = k => S.occSort[0] === k ? (S.occSort[1] > 0 ? " ▲" : " ▼") : "";
  $("#occTable").innerHTML = `<table class="occ"><thead><tr>${cols.map(([k, l]) => `<th data-sort="${k}"${k === "n" ? ' style="text-align:right"' : ""}>${l}${arrow(k)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(r => `<tr class="row${selSet.has(r.key) ? " on" : ""}" data-key="${esc(r.key)}">
      <td title="${esc(r.progName)}">${esc(r.prog)}</td><td>${esc(r.country)}</td><td>${esc(r.year)}</td>
      <td><code>${esc(r.o[1])}</code>${r.o[2] ? `<div class="alt">${esc(r.o[2])}</div>` : ""}</td>
      <td class="num">${fmt(r.o[3])}</td></tr>`).join("")}</tbody></table>`;
}

/* ---------- distributions ---------- */
function toggleSel(keys, forceOn) {
  const set = new Set(S.sel);
  const allOn = keys.every(k => set.has(k));
  const on = forceOn ?? !allOn;
  for (const k of keys) { if (on) { if (!set.has(k)) S.sel.unshift(k); } else S.sel = S.sel.filter(x => x !== k); }
  refreshSelection();
}

function refreshSelection() {
  renderOccTable();
  const selSet = new Set(S.sel);
  document.querySelectorAll("table.cov td[data-iso]").forEach(td => {
    const hit = S.occ.some(r => r.iso === td.dataset.iso && r.year === td.dataset.year && selSet.has(r.key));
    td.classList.toggle("sel", hit);
  });
  renderDists();
}

function renderDists() {
  const card = $("#distCard");
  if (!card) return;
  const byKey = new Map(S.occ.map(r => [r.key, r]));
  const sel = S.sel.map(k => byKey.get(k)).filter(Boolean);
  if (!sel.length) {
    card.innerHTML = `<h3>Answer distributions</h3><p class="muted">Select datasets in the table or the coverage grid to compare their answer distributions.</p>`;
    return;
  }
  card.innerHTML = `<h3>Answer distributions <span class="muted" style="font-weight:400">${sel.length} selected</span><span class="spacer"></span>
      <label class="toggle"><input type="checkbox" id="exMiss" ${S.excludeMissing ? "checked" : ""}> Exclude missing codes from %</label>
      <button class="btn small" id="clearSel">Clear</button></h3>
    <div class="dists">${sel.map(distCard).join("")}</div>
    <p class="note">Grey bars are missing or non-substantive codes (negative values, “Don’t know”, “Refused” and similar), matched by value and label. Percentages are of the counts shown.</p>`;
}

function distCard(r) {
  const [, varname, rawLabel, nonmiss, d] = r.o;
  const title = `<h4>${esc(r.country)} · ${esc(r.year)} · ${esc(r.prog)}</h4>
    <div class="dsub"><code>${esc(varname)}</code>${rawLabel ? " · " + esc(rawLabel) : ""}${nonmiss != null ? ` · N valid ${fmt(nonmiss)}` : ""}</div>
    <button class="x" data-rm="${esc(r.key)}" aria-label="Remove">×</button>`;
  if (!d) return `<div class="dist">${title}<p class="muted">No distribution stored.</p></div>`;
  let rows = (d.r || []).map(([v, l, n]) => ({ v, l, n: n || 0, miss: isMissing(v, l) }));
  if (S.excludeMissing) rows = rows.filter(x => !x.miss);
  const histTotal = d.h ? d.h[2].reduce((a, b) => a + b, 0) : 0;
  const total = rows.reduce((a, x) => a + x.n, 0) + histTotal + (S.excludeMissing ? 0 : (d.o || 0));
  const max = Math.max(1, ...rows.map(x => x.n));
  let html = "";
  if (d.h) {
    const [lo, hi, bins] = d.h, bmax = Math.max(1, ...bins), w = (hi - lo) / bins.length;
    html += `<div class="hist">${bins.map((b, i) => `<div style="height:${(100 * b / bmax).toFixed(1)}%" data-tip="${esc(`${num(lo + i * w)} to ${num(lo + (i + 1) * w)}: ${fmt(b)} (${pct(b, total)})`)}"></div>`).join("")}</div>
      <div class="hist-axis"><span>${num(lo)}</span><span>Unlabelled numeric values (${fmt(histTotal)})</span><span>${num(hi)}</span></div>`;
  }
  if (rows.length) {
    html += `<div class="bars" style="margin-top:${d.h ? 10 : 0}px">${rows.map(x => {
      const name = x.l && x.l !== x.v ? `<span class="v">${esc(x.v)}</span> ${esc(x.l)}` : `<span class="v">${esc(x.v)}</span>`;
      const plain = x.l && x.l !== x.v ? `${x.v} ${x.l}` : x.v;
      return `<div class="row" data-tip="${esc(`${plain}: ${fmt(x.n)} (${pct(x.n, total)})`)}"><div class="bl" title="${esc(plain)}">${name}</div>
        <div class="track"><div class="fill${x.miss ? " miss" : ""}" style="width:${(100 * x.n / max).toFixed(1)}%"></div></div>
        <div class="pct">${pct(x.n, total)}<span>${fmt(x.n)}</span></div></div>`;
    }).join("")}</div>`;
  }
  if (d.o && !S.excludeMissing) html += `<p class="note">${fmt(d.o)} responses in other, less frequent values are not shown.</p>`;
  return `<div class="dist">${title}${html}</div>`;
}

function isMissing(v, l) {
  const n = Number(v);
  if (!Number.isNaN(n) && n < 0) return true;
  return !!(l && MISSING_RE.test(l));
}
const pct = (n, t) => !t ? "–" : !n ? "0%" : (100 * n / t).toFixed(n / t < 0.1 ? 1 : 0) + "%";
const num = x => Math.abs(x) >= 1000 || Number.isInteger(x) ? fmt(Math.round(x)) : (+x.toPrecision(3)).toString();

/* ---------- URL state (shareable links) ---------- */
function updateHash() {
  const p = new URLSearchParams();
  const q = $("#q").value.trim();
  if (q) p.set("s", q);
  if (S.applied.prog) p.set("p", S.meta.progs[+S.applied.prog][0]);
  if (S.applied.sort !== "rel") p.set("o", S.applied.sort);
  if (S.active != null) p.set("q", S.active);
  history.replaceState(null, "", "#" + p.toString());
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("s")) $("#q").value = p.get("s");
  if (p.get("p")) { const i = S.meta.progs.findIndex(x => x[0] === p.get("p")); if (i >= 0) $("#prog").value = i; }
  if (SORT_LABELS[p.get("o")]) $("#sort").value = p.get("o");
  S.applied = { prog: $("#prog").value, sort: $("#sort").value };
  return p.get("q") != null ? +p.get("q") : null;
}

/* ---------- tooltip ---------- */
function tipAt(e, html) {
  const tip = $("#tip");
  if (!html) { tip.hidden = true; return; }
  tip.innerHTML = html; tip.hidden = false;
  const pad = 14, r = tip.getBoundingClientRect();
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}

/* ---------- events ---------- */
function bind() {
  let t;
  $("#q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { runSearch(); updateHash(); }, 120); });
  $("#filters").addEventListener("change", renderActive);
  $("#filters").addEventListener("submit", e => { e.preventDefault(); applyFilters(); });
  $("#active").addEventListener("click", e => {
    const b = e.target.closest("[data-clear]");
    if (!b) return;
    if (b.dataset.clear === "prog") $("#prog").value = ""; else $("#sort").value = "rel";
    applyFilters();
  });
  // keep the sticky results panel below the header, whatever height the header wraps to
  new ResizeObserver(() => document.documentElement.style.setProperty("--head-h", $(".top").offsetHeight + "px")).observe($(".top"));
  $("#more").addEventListener("click", renderMore);
  const pick = e => { const li = e.target.closest("li[data-g]"); if (li) openQuestion(+li.dataset.g); };
  $("#results").addEventListener("click", pick);
  $("#results").addEventListener("keydown", e => { if (e.key === "Enter") pick(e); });

  const det = $("#detail");
  det.addEventListener("click", e => {
    const td = e.target.closest("td[data-iso]");
    if (td) return toggleSel(S.occ.filter(r => r.iso === td.dataset.iso && r.year === td.dataset.year).map(r => r.key));
    const th = e.target.closest("th[data-sort]");
    if (th) { const k = th.dataset.sort; S.occSort = [k, S.occSort[0] === k ? -S.occSort[1] : 1]; return renderOccTable(); }
    const tr = e.target.closest("tr.row");
    if (tr) return toggleSel([tr.dataset.key]);
    const rm = e.target.closest("[data-rm]");
    if (rm) return toggleSel([rm.dataset.rm], false);
    if (e.target.id === "clearSel") { S.sel = []; return refreshSelection(); }
    if (e.target.id === "selAll") return toggleSel(filteredOcc().slice(0, 12).map(r => r.key), true);
  });
  det.addEventListener("change", e => { if (e.target.id === "exMiss") { S.excludeMissing = e.target.checked; renderDists(); } });
  det.addEventListener("input", e => { if (e.target.id === "occFilter") { S.occFilter = e.target.value; renderOccTable(); } });
  det.addEventListener("mousemove", e => {
    const td = e.target.closest("td[data-iso]");
    if (td) {
      const list = S.occ.filter(r => r.iso === td.dataset.iso && r.year === td.dataset.year);
      return tipAt(e, `<b>${esc(list[0].country)} ${esc(td.dataset.year)}</b>${list.map(r => `${esc(r.prog)} · ${esc(r.o[1])} · N ${fmt(r.o[3])}`).join("<br>")}`);
    }
    const tipEl = e.target.closest("[data-tip]");
    tipAt(e, tipEl ? esc(tipEl.dataset.tip) : null);
  });
  det.addEventListener("mouseleave", () => tipAt(null, null));
}

/* ---------- start ---------- */
(async function init() {
  try {
    const meta = await loadGz("meta.json.gz", { cache: "no-cache" });
    VERSION = meta.built;
    const idx = await loadGz("index.json.gz");
    S.meta = meta; S.idx = idx;
    S.hay = idx.label.map((l, i) => (l + " " + idx.vars[i]).toLowerCase());
    const total = idx.n.reduce((a, b) => a + b, 0);
    $("#stats").textContent = `${fmt(idx.label.length)} questions · ${fmt(total)} variables · ${fmt(meta.files.length)} datasets · ${meta.progs.length} programmes · ${meta.countries.length} countries · built ${meta.built}`;
    $("#prog").insertAdjacentHTML("beforeend", meta.progs.map((p, i) => `<option value="${i}">${esc(p[0])}: ${esc(p[1])}</option>`).join(""));
    bind();
    const q = readHash();
    runSearch();
    renderActive();
    if (q != null && q < idx.label.length) openQuestion(q);
  } catch (e) {
    $("#stats").innerHTML = `<span class="err">Could not load data (${esc(e.message)}). Serve this folder over HTTP; opening index.html directly from disk does not work.</span>`;
  }
})();
