"use strict";
/* Survey Dictionary: static front end.
   Data (built by build_data.R) lives in data/: meta.json.gz, index.json.gz, q/<shard>.json.gz
   Views (in the URL hash):  search (default) · v=programmes (programme cards) · v=prog&pg=CODE (one programme) */

// Where the data files live: set in config.js (e.g. a GCS bucket URL); defaults to ./data/
const DATA = window.SD_DATA_URL || "data/";
const PAGE = 100;
const MISSING_RE = /(don'?t know|\bdk\b|refus|no answer|\bn\/?a\b|not applicable|inap|missing|can'?t choose|decline|not asked|no reply|skipped|dk\/na|dont know)/i;
const SORT_LABELS = { rel: "Best match", n: "Most datasets", nc: "Most countries" };

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => n == null ? "–" : Number(n).toLocaleString("en-US");
const yrs = (a, b) => a === b ? `${a}` : `${a}–${b}`;

const S = {
  meta: null, idx: null, hay: null, progStats: [],
  view: "search",            // "search" | "programmes" | "prog"
  pg: null,                  // programme index in the "prog" view
  hits: [], shown: 0, active: null, terms: [],
  applied: { progs: [], sort: "rel" },  // filter/sort in effect (controls only count after "Apply filter")
  pending: new Set(),                   // programmes ticked in the checklist, not yet applied
  shards: new Map(),
  occAll: [], occ: [],       // occurrences of the open question: all, and those in scope
  showAll: false,            // show the open question's datasets from every programme, ignoring the filter
  sel: [], occFilter: "", occSort: ["prog", 1],
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
  const [p, c, y, nv] = S.meta.files[fid];
  return { pidx: p, prog: S.meta.progs[p][0], progName: S.meta.progs[p][1], iso: S.meta.countries[c][0], country: S.meta.countries[c][1], year: y, nvars: nv };
};
const occKey = o => `${o[0]}|${o[1]}`;
const progCode = p => S.meta.progs[p][0];
const progHref = p => `#v=prog&pg=${encodeURIComponent(progCode(p))}`;

// programmes that currently limit results: the one programme in its own view, else the applied filter
const scope = () => S.view === "prog" ? [S.pg] : S.applied.progs;

// a question's datasets / countries / years within some programmes (all programmes when sc is empty).
// Countries across several programmes can overlap, so for more than one the largest single count is used.
function qStats(i, sc = scope()) {
  const { idx } = S;
  if (!sc.length) return { n: idx.n[i], nc: idx.nc[i], y0: idx.y0[i], y1: idx.y1[i] };
  let n = 0, nc = 0, y0 = Infinity, y1 = -Infinity;
  for (const [p, pn, pc, a, b] of idx.progs[i]) {
    if (!sc.includes(p)) continue;
    n += pn; nc = Math.max(nc, pc); y0 = Math.min(y0, a); y1 = Math.max(y1, b);
  }
  return { n, nc, y0, y1 };
}

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
  const { sort } = S.applied;
  const { idx } = S;
  const sc = scope(), scSet = new Set(sc);
  const terms = q.split(/\s+/).filter(Boolean);
  const hits = [];
  for (let i = 0; i < idx.label.length; i++) {
    if (sc.length && !idx.progs[i].some(x => scSet.has(x[0]))) continue;
    const h = S.hay[i];
    let ok = true;
    for (const t of terms) if (!h.includes(t)) { ok = false; break; }
    if (ok) hits.push(i);
  }
  const st = sc.length ? new Map(hits.map(i => [i, qStats(i, sc)])) : null;
  const N = i => st ? st.get(i).n : idx.n[i];
  const NC = i => st ? st.get(i).nc : idx.nc[i];
  if (sort === "n") hits.sort((a, b) => N(b) - N(a));
  else if (sort === "nc") hits.sort((a, b) => NC(b) - NC(a) || N(b) - N(a));
  else if (q) {
    const score = i => {
      const l = idx.label[i].toLowerCase();
      return (l.includes(q) ? 2 : 0) + (l.startsWith(q) ? 1 : 0);
    };
    const sco = new Map(hits.map(i => [i, score(i)]));
    hits.sort((a, b) => sco.get(b) - sco.get(a) || NC(b) - NC(a) || N(b) - N(a));
  } else if (st) hits.sort((a, b) => N(b) - N(a));
  S.hits = hits; S.shown = 0; S.terms = terms;
  $("#results").innerHTML = "";
  const where = sc.length ? ` in ${sc.map(progCode).join(", ")}` : "";
  $("#resultsHead").textContent = `${fmt(hits.length)} question${hits.length === 1 ? "" : "s"}${q ? " match" : ""}${where}`;
  renderMore();
}

function renderMore() {
  const { idx } = S;
  const scSet = new Set(S.applied.progs);
  const slice = S.hits.slice(S.shown, S.shown + PAGE);
  const html = slice.map(i => {
    let meta;
    if (S.view === "prog") {
      const s = qStats(i, [S.pg]), others = idx.progs[i].length - 1;
      meta = `${fmt(s.n)} datasets · ${s.nc} ${s.nc === 1 ? "country" : "countries"} · ${yrs(s.y0, s.y1)}${others ? ` · <span class="also">also in ${others} other programme${others === 1 ? "" : "s"}</span>` : ""}`;
    } else {
      // every programme that asked it; the ones picked in the filter are highlighted
      const progs = idx.progs[i].map(([p]) => scSet.has(p) ? `<b class="psel">${esc(progCode(p))}</b>` : esc(progCode(p))).join(", ");
      meta = `${fmt(idx.n[i])} datasets · ${idx.nc[i]} ${idx.nc[i] === 1 ? "country" : "countries"} · ${yrs(idx.y0[i], idx.y1[i])} · ${progs}`;
    }
    return `<li data-g="${i}" class="${i === S.active ? "active" : ""}" tabindex="0">
      <div class="lbl">${highlight(idx.label[i], S.terms)}</div><div class="meta">${meta}</div></li>`;
  }).join("");
  $("#results").insertAdjacentHTML("beforeend", html);
  S.shown += slice.length;
  const total = S.hits.length, left = total - S.shown;
  $("#more").hidden = left <= 0;
  $("#more").textContent = `Show ${fmt(Math.min(PAGE, left))} more (${fmt(S.shown)} of ${fmt(total)} shown)`;
  $("#allShown").hidden = left > 0;
  $("#allShown").textContent = total === 0
    ? `No questions match. Try fewer or shorter words${S.view === "search" && S.applied.progs.length ? ", or remove a programme filter" : ""}.`
    : `All ${fmt(total)} result${total === 1 ? "" : "s"} shown`;
}

/* ---------- filters (applied with the button) ---------- */
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
const isDirty = () => $("#sort").value !== S.applied.sort ||
  (S.view === "search" && !sameSet(S.pending, new Set(S.applied.progs)));

function buildProgList() {
  $("#progList").innerHTML = S.meta.progs.map(([code, name], i) => `<li role="option" data-p="${i}">
      <label><input type="checkbox" value="${i}"><b>${esc(code)}</b><span class="nm">${esc(name)}</span><span class="ct">${fmt(S.progStats[i].files)}</span></label></li>`).join("");
}

function progLabel(list) {
  const codes = [...list].sort((a, b) => a - b).map(progCode);
  if (!codes.length) return "All programmes";
  return codes.length <= 3 ? codes.join(", ") : `${codes.length} selected: ${codes.slice(0, 2).join(", ")}, …`;
}

function syncProgList() {
  document.querySelectorAll("#progList li").forEach(li => {
    const on = S.pending.has(+li.dataset.p);
    li.classList.toggle("on", on);
    li.setAttribute("aria-selected", on);
    $("input", li).checked = on;
  });
  $("#progBtn").textContent = progLabel(S.pending);
  $("#progBtn").classList.toggle("has", S.pending.size > 0);
}

function applyFilters() {
  S.applied = { progs: S.view === "search" ? [...S.pending].sort((a, b) => a - b) : [], sort: $("#sort").value };
  closePop();
  runSearch(); updateHash(); renderActive();
  if (S.active != null && S.occAll.length) { S.showAll = false; applyScope(); renderDetail(); }
}

function renderActive() {
  const dirty = isDirty();
  $("#apply").disabled = !dirty;
  $("#filters").classList.toggle("dirty", dirty);
  syncProgList();
  const chips = [];
  if (S.view === "search") for (const p of S.applied.progs) {
    chips.push(`<span class="fchip">Programme: <b>${esc(progCode(p))}</b><button type="button" data-clear="prog" data-p="${p}" aria-label="Remove ${esc(progCode(p))} filter">×</button></span>`);
  }
  if (S.applied.sort !== "rel") chips.push(`<span class="fchip">Sorted by: <b>${SORT_LABELS[S.applied.sort]}</b><button type="button" data-clear="sort" aria-label="Reset sorting">×</button></span>`);
  if (S.view === "search" && S.applied.progs.length > 1) chips.push(`<button type="button" class="linkbtn" data-clear="allprogs">Clear programme filters</button>`);
  $("#active").innerHTML =
    (chips.length ? `<span>Active:</span>${chips.join("")}` : "") +
    (dirty ? `<span class="pending">Changes not applied yet: click “Apply filter”</span>` : "");
}

const openPop = () => { $("#progPop").hidden = false; $("#progBtn").setAttribute("aria-expanded", "true"); };
const closePop = () => { $("#progPop").hidden = true; $("#progBtn").setAttribute("aria-expanded", "false"); };

/* ---------- views & URL state (shareable links) ---------- */
function updateHash() {
  const p = new URLSearchParams();
  if (S.view === "programmes") p.set("v", "programmes");
  else {
    if (S.view === "prog") { p.set("v", "prog"); p.set("pg", progCode(S.pg)); }
    const q = $("#q").value.trim();
    if (q) p.set("s", q);
    if (S.view === "search" && S.applied.progs.length) p.set("p", S.applied.progs.map(progCode).join(","));
    if (S.applied.sort !== "rel") p.set("o", S.applied.sort);
    if (S.active != null) p.set("q", S.active);
  }
  history.replaceState(null, "", "#" + p.toString());
}

// Called on load and whenever a link changes the hash (tabs, programme cards, back button).
function route() {
  const p = new URLSearchParams(location.hash.slice(1));
  const codeIdx = c => S.meta.progs.findIndex(x => x[0] === c);
  let view = p.get("v") === "programmes" ? "programmes" : p.get("v") === "prog" ? "prog" : "search";
  let pg = view === "prog" ? codeIdx(p.get("pg")) : null;
  if (view === "prog" && pg < 0) view = "programmes";
  S.view = view; S.pg = pg;
  $("#q").value = p.get("s") || "";
  $("#sort").value = SORT_LABELS[p.get("o")] ? p.get("o") : "rel";
  const progs = view === "search" ? (p.get("p") || "").split(",").map(codeIdx).filter(i => i >= 0).sort((a, b) => a - b) : [];
  S.applied = { progs, sort: $("#sort").value };
  S.pending = new Set(progs);
  S.active = null; S.occAll = []; S.occ = []; S.sel = []; S.showAll = false;
  closePop();

  $("#tabSearch").classList.toggle("on", view === "search");
  $("#tabProgs").classList.toggle("on", view !== "search");
  $("#controls").hidden = view === "programmes";
  $("#active").hidden = view === "programmes";
  $("#layout").hidden = view === "programmes";
  $("#progIndex").hidden = view !== "programmes";
  $("#progField").hidden = view !== "search";
  const ctx = $("#context");
  ctx.hidden = view !== "prog";
  if (view === "prog") {
    const [code, name] = S.meta.progs[pg];
    ctx.innerHTML = `<a href="#v=programmes">Survey programmes</a> <span aria-hidden="true">›</span> <b>${esc(code)}</b> <span class="muted">${esc(name)}</span>`;
    $("#qLabel").textContent = `Search within ${code}`;
  } else $("#qLabel").textContent = "Search";

  if (view === "programmes") { renderProgIndex(); window.scrollTo(0, 0); return; }
  runSearch(); renderActive();
  const q = p.get("q");
  if (q != null && +q < S.idx.label.length) openQuestion(+q); else renderHome();
  window.scrollTo(0, 0);
}

/* ---------- programme cards & programme overview ---------- */
function computeProgStats() {
  S.progStats = S.meta.progs.map(() => ({ files: 0, countries: new Set(), y0: Infinity, y1: -Infinity, nvars: 0, nq: 0 }));
  for (const [p, c, y, nv] of S.meta.files) {
    const st = S.progStats[p], yr = parseInt(y, 10);
    st.files++; st.countries.add(c); st.nvars += nv || 0;
    if (yr) { st.y0 = Math.min(st.y0, yr); st.y1 = Math.max(st.y1, yr); }
  }
  for (const list of S.idx.progs) for (const [p] of list) S.progStats[p].nq++;
}

function renderProgIndex() {
  const order = S.meta.progs.map((_, i) => i).sort((a, b) => S.progStats[b].files - S.progStats[a].files);
  $("#progIndex").innerHTML = `
    <div class="pi-head"><h2>Survey programmes</h2>
      <p class="muted">Select a programme to see all its datasets and search only its questions.</p></div>
    <div class="cards">${order.map(i => {
      const [code, name] = S.meta.progs[i], st = S.progStats[i];
      return `<a class="pcard" href="${progHref(i)}">
        <div class="pc-code">${esc(code)}</div>
        <div class="pc-name">${esc(name)}</div>
        <div class="pc-stats">
          <span><b>${fmt(st.files)}</b> datasets</span><span><b>${st.countries.size}</b> countries</span>
          <span><b>${yrs(st.y0, st.y1)}</b></span><span><b>${fmt(st.nq)}</b> questions</span>
        </div></a>`;
    }).join("")}</div>`;
}

function renderHome() {
  S.active = null;
  document.querySelectorAll("#results li.active").forEach(li => li.classList.remove("active"));
  if (S.view === "prog") return renderProgOverview();
  $("#detail").innerHTML = `<div class="empty">
      <h2>Search the question labels</h2>
      <p>Type a keyword to search every variable label across all survey programmes, countries and years. Select a question to see where it was asked and its answer distributions.</p>
      <p>To focus on one programme, open the <a href="#v=programmes">Survey programmes</a> tab. To search several at once, tick them under “Filter: survey programmes”.</p>
      <p class="muted">Questions are grouped by normalised label text: lower case, with punctuation and leading question numbers such as “Q8.” or “QA11B” removed. The same concept worded differently is therefore listed separately.</p>
    </div>`;
}

function renderProgOverview() {
  const pg = S.pg, [code, name] = S.meta.progs[pg], st = S.progStats[pg];
  const files = S.meta.files.map((f, fid) => f[0] === pg ? fileInfo(fid) : null).filter(Boolean);
  const years = [...new Set(files.map(f => f.year))].sort();
  const byC = new Map();
  for (const f of files) {
    if (!byC.has(f.iso)) byC.set(f.iso, { name: f.country, cells: new Map() });
    byC.get(f.iso).cells.set(f.year, f);
  }
  const rows = [...byC.values()].sort((a, b) => a.name.localeCompare(b.name));
  const grid = `<table class="cov"><thead><tr><th></th>${years.map(y => `<th>${esc(y)}</th>`).join("")}</tr></thead><tbody>${rows.map(c =>
    `<tr><th title="${esc(c.name)}">${esc(c.name)}</th>${years.map(y => {
      const f = c.cells.get(y);
      return f ? `<td class="c3" data-tip="${esc(`${c.name} ${y}: ${fmt(f.nvars)} variables`)}"></td>` : "<td></td>";
    }).join("")}</tr>`).join("")}</tbody></table>`;
  $("#detail").innerHTML = `
    <div class="card">
      <div class="eyebrow">Survey programme</div>
      <h2 class="qtitle">${esc(name)}</h2>
      <div class="kpis">
        <div class="kpi"><b>${fmt(st.files)}</b><span>datasets</span></div>
        <div class="kpi"><b>${st.countries.size}</b><span>countries</span></div>
        <div class="kpi"><b>${yrs(st.y0, st.y1)}</b><span>${years.length} survey years</span></div>
        <div class="kpi"><b>${fmt(st.nq)}</b><span>distinct questions</span></div>
        <div class="kpi"><b>${fmt(st.nvars)}</b><span>variables in total</span></div>
      </div>
      <p class="muted" style="margin:12px 0 0">Search or browse this programme’s questions on the left. Select one to see where it was asked and its answer distributions.</p>
    </div>
    <div class="card">
      <h3>Datasets by country and year <span class="muted" style="font-weight:400">Hover a cell to see its number of variables</span></h3>
      <div class="cov-wrap">${grid}</div>
      <div class="legend"><span><i style="background:var(--cell-3)"></i>dataset available</span><span><i style="background:var(--surface-2)"></i>none</span></div>
    </div>`;
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
  S.occAll = shard[g].map(o => ({ o, key: occKey(o), ...fileInfo(o[0]) }));
  if (!keepSel) S.sel = [];
  S.occFilter = ""; S.showAll = false;
  applyScope();
  renderDetail();
}

// restrict the open question's datasets to the programmes in scope (unless "show all" is on)
function applyScope() {
  const sc = S.showAll ? [] : scope();
  S.occ = sc.length ? S.occAll.filter(r => sc.includes(r.pidx)) : S.occAll;
  if (!S.occ.length) S.occ = S.occAll;
  const keys = new Set(S.occ.map(r => r.key));
  S.sel = S.sel.filter(k => keys.has(k));
}

function renderDetail() {
  const g = S.active, { idx } = S;
  const occ = S.occ;
  const nds = list => new Set(list.map(r => r.o[0])).size;   // distinct datasets (a dataset can have several matching variables)
  const countries = new Set(occ.map(r => r.iso));
  const years = [...new Set(occ.map(r => r.year))].sort();
  const progs = new Set(occ.map(r => r.prog));
  const variants = new Map();
  for (const r of occ) { const l = r.o[2] || idx.label[g]; variants.set(l, (variants.get(l) || 0) + 1); }
  const vlist = [...variants].sort((a, b) => b[1] - a[1]);
  const varnames = new Map();
  for (const r of occ) varnames.set(r.o[1], (varnames.get(r.o[1]) || 0) + 1);

  // scope notice: which programmes' datasets are shown, with a switch to show every programme
  const sc = scope();
  let scopeBar = "";
  if (sc.length && S.occAll.length !== occ.length) {
    scopeBar = `<div class="scope">Showing <b>${fmt(nds(occ))}</b> of ${fmt(nds(S.occAll))} datasets: ${esc(sc.map(progCode).join(", "))} only.
      <button type="button" class="linkbtn" data-act="showall">Show all programmes</button></div>`;
  } else if (sc.length && S.showAll) {
    scopeBar = `<div class="scope">Showing all ${fmt(nds(occ))} datasets from every programme.
      <button type="button" class="linkbtn" data-act="scoped">Only ${esc(sc.map(progCode).join(", "))}</button></div>`;
  }
  const back = S.view === "prog" ? `<button type="button" class="linkbtn back" data-act="home">← ${esc(progCode(S.pg))} overview</button>` : "";
  const progLinks = idx.progs[g].map(([p, n]) => `<a class="chip plink${sc.includes(p) ? " on" : ""}" href="${progHref(p)}" title="Open ${esc(S.meta.progs[p][1])}">${esc(progCode(p))} · ${fmt(n)}</a>`).join("");

  $("#detail").innerHTML = `${back}
    <div class="card">
      <h2 class="qtitle">${esc(idx.label[g])}</h2>
      ${scopeBar}
      <div class="kpis">
        <div class="kpi"><b>${fmt(nds(occ))}</b><span>datasets</span></div>
        <div class="kpi"><b>${countries.size}</b><span>countries</span></div>
        <div class="kpi"><b>${yrs(years[0], years[years.length - 1])}</b><span>${years.length} survey years</span></div>
        <div class="kpi"><b>${progs.size}</b><span>programme${progs.size === 1 ? "" : "s"}</span></div>
        ${occ.length !== nds(occ) ? `<div class="kpi"><b>${fmt(occ.length)}</b><span>variables</span></div>` : ""}
      </div>
      <div class="chips"><span class="chips-lbl">Asked in</span>${progLinks}</div>
      <div class="chips"><span class="chips-lbl">Variables</span>${[...varnames].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([v, n]) => `<span class="chip" title="${n} datasets"><code>${esc(v)}</code></span>`).join("")}</div>
      ${vlist.length > 1 ? `<details class="variants"><summary>${vlist.length} label variants in this group</summary><ul>${vlist.slice(0, 50).map(([l, n]) => `<li>${esc(l)} <span class="muted">(${n})</span></li>`).join("")}</ul></details>` : ""}
    </div>

    <div class="card">
      <h3>Where it was asked <span class="muted" style="font-weight:400">Select a cell to view its distribution</span></h3>
      <div class="cov-wrap">${coverageTable(occ, years)}</div>
      <div class="legend"><span><i style="background:var(--cell-1)"></i>1 dataset</span><span><i style="background:var(--cell-2)"></i>2</span><span><i style="background:var(--cell-3)"></i>3 or more</span><span><i style="background:var(--surface-2)"></i>not asked</span></div>
    </div>

    <div class="card">
      <h3>All datasets <span class="muted" style="font-weight:400">One row per variable</span><span class="spacer"></span>
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
  $("#more").addEventListener("click", renderMore);
  const pick = e => { const li = e.target.closest("li[data-g]"); if (li) openQuestion(+li.dataset.g); };
  $("#results").addEventListener("click", pick);
  $("#results").addEventListener("keydown", e => { if (e.key === "Enter") pick(e); });
  window.addEventListener("hashchange", route);

  // filters: programme checklist + sort, applied with the button
  $("#progBtn").addEventListener("click", () => $("#progPop").hidden ? openPop() : closePop());
  $("#progList").addEventListener("change", e => {
    const p = +e.target.value;
    if (e.target.checked) S.pending.add(p); else S.pending.delete(p);
    renderActive();
  });
  $("#progPop").addEventListener("click", e => {
    const b = e.target.closest("[data-msel]");
    if (!b) return;
    S.pending = b.dataset.msel === "all" ? new Set(S.meta.progs.map((_, i) => i)) : new Set();
    renderActive();
  });
  document.addEventListener("click", e => { if (!e.target.closest(".msel")) closePop(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closePop(); });
  $("#filters").addEventListener("change", e => { if (e.target.id === "sort") renderActive(); });
  $("#filters").addEventListener("submit", e => { e.preventDefault(); applyFilters(); });
  $("#active").addEventListener("click", e => {
    const b = e.target.closest("[data-clear]");
    if (!b) return;
    if (b.dataset.clear === "prog") S.pending.delete(+b.dataset.p);
    else if (b.dataset.clear === "allprogs") S.pending.clear();
    else $("#sort").value = "rel";
    applyFilters();
  });
  // keep the sticky results panel below the header, whatever height the header wraps to
  new ResizeObserver(() => document.documentElement.style.setProperty("--head-h", $(".top").offsetHeight + "px")).observe($(".top"));

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
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "home") { renderHome(); updateHash(); return; }
    if (act === "showall" || act === "scoped") { S.showAll = act === "showall"; applyScope(); return renderDetail(); }
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
    computeProgStats();
    const total = meta.files.reduce((a, f) => a + (f[3] || 0), 0);
    $("#stats").textContent = `${fmt(idx.label.length)} questions · ${fmt(total)} variables · ${fmt(meta.files.length)} datasets · ${meta.progs.length} programmes · ${meta.countries.length} countries · built ${meta.built}`;
    buildProgList();
    bind();
    route();
  } catch (e) {
    console.error(e);
    $("#stats").innerHTML = `<span class="err">Could not load data (${esc(e.message)}). Serve this folder over HTTP; opening index.html directly from disk does not work.</span>`;
  }
})();
