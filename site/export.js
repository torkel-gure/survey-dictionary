"use strict";
/* Export tab: collect questions (bookmark marker on each result), customise what to include,
   compile a Word document, and save / load the selection as an "overview source" JSON file.
   Uses the globals of app.js (S, $, esc, fmt, getShard, fileInfo, ...). Nothing is stored in the browser. */

const DOCX_URL = "https://cdn.jsdelivr.net/npm/docx@9.8.1/dist/index.iife.js";
const SOURCE_FORMAT = "survey-dictionary-overview-source";
const SOURCE_VERSION = 1;

const E = {
  doc: null,              // document settings (title, subtitle, methodology, ...)
  items: [],              // selected questions in document order
  byGid: new Map(),       // question id -> item
  occ: new Map(),         // question id -> its datasets (loaded from the question shards)
  keys: null,             // question keys, loaded only to save / load overview sources
  stemFid: null,          // overview file name -> dataset id
  dirty: false,           // unsaved changes (warn before leaving the page)
  msg: null,
};

const defaultDoc = () => ({
  title: "Survey question overview",
  subtitle: "",
  includeMethodology: true,
  methodology: defaultMethodology(),
  includeExcluded: true,
  includeSummary: true,
});

const newItem = g => ({
  gid: g, open: false, progs: null,  // progs: programme ids to include, null = all programmes that asked it
  coverage: true, varnames: true, variants: true, excludeMissing: false, comment: "",
  dists: new Set(),                   // "<overview file name>|<variable>" of the distributions to include
});

/* ---------- methodology (default text, editable in the export tab) ---------- */
function defaultMethodology() {
  const m = S.meta;
  const nFiles = m.files.length, nCountries = m.countries.length, nProgs = m.progs.length;
  const nWaves = m.files.filter(f => f[4]).length;
  const excl = m.excluded || [];
  const nRange = excl.filter(e => /more than two years/.test(e[4])).length;
  return `## Data and unit of observation
The dictionary is generated from ${fmt(nFiles)} survey datasets from ${nProgs} survey programmes covering ${nCountries} countries. The original survey data files are not distributed with the dictionary; for each programme a mapping file lists its data files, the survey year range of each file (survey_year_range), the year and country variables, the wave or round, and a link to the survey documentation.

Each data file is split into datasets at the survey–country–year level, and every dataset is summarised variable by variable. The basic structure is therefore country–year–question. Where a programme fielded several waves in the same year, each wave is kept as a separate dataset (${fmt(nWaves)} datasets carry a wave label), so one country–year can hold more than one dataset.

## Panel surveys
Panel studies distributed as one wide file (one row per panelist, with a wave suffix on every variable) were first split into one file per wave. Respondents are kept only in the waves they took part in (BES Internet Panel: the wave participation flag; VOTER Survey: the interview start time, or any recorded answer for 2011 and 2012), and the wave suffix is removed from the variable names. In the BES Internet Panel, time-invariant profile variables are repeated in every wave and variables that combine several waves are assigned to the last of them. In the VOTER Survey, birth year, gender and state are filled from the nearest wave in which the respondent reported them.

## Country
Countries are identified from the country variable named in the mapping file: labelled codes are converted to country names and matched to ISO 3166-1 alpha-3 codes with a lookup table. Single-country studies are assigned their country directly (for example ANES, CES, GSS, VOTER and MEOF: United States; SOM: Sweden; BES: United Kingdom; KGSS: South Korea; JGSS: Japan). Files with respondents that cannot be matched to a country are not processed.

## Year
The year of each respondent is set as follows:
- If survey_year_range covers a single year, that year is assigned to all respondents, and any year variable in the data is ignored.
- If the range covers several years and the data contain the year variable named in the mapping file, the year is taken from the data and the file is split by year. Date variables are converted to calendar years.
- If the range covers several years and the data have no year variable, the latest year of the range is assigned to all respondents when the range spans two consecutive years (for example, 2019–2020 is recorded as 2020). When it spans more than two years, the file is excluded.
Respondents with a missing year are dropped.

## Variables and questions
Within each dataset, variables that take only one value (including variables that are entirely missing, typically questions not asked in that country or year) are removed. For every remaining variable the overview records its name, label, number of distinct values, number of non-missing responses, minimum and maximum, and the frequency of each value with its value label.

In this dictionary, variables are grouped into questions by their label: labels are lower-cased, leading question numbers (such as “Q8.” or “QA11B”) and punctuation are removed, and identical results form one question. Differently worded versions of the same concept are therefore separate questions, and identically labelled items may be grouped together. The exact question wording should always be checked in the survey documentation (codebooks and questionnaires) linked for each source file.

## Answer distributions
Distributions are unweighted counts of respondents per value. For variables with up to 25 distinct values all labelled answer options are shown, including those without responses. Variables with many unlabelled numeric values (such as age, income or weights) are summarised as histograms, and for long lists of text values the 30 most frequent are shown. Missing and non-substantive codes (negative values and labels such as “Don’t know” or “Refused”) are identified heuristically from values and labels.

## Limitations
- The year rule for two-year ranges without a year variable records fieldwork carried out in the earlier year under the later year.
- Survey years are those recorded in the data or the mapping files and may differ from the fieldwork period.
- Distributions are unweighted and are not suitable as population estimates.
- ${fmt(excl.length)} of the ${fmt(m.mappingFiles || 0)} survey files listed in the mapping files are not included${nRange ? `, ${nRange} of them because their year range covers more than two years without a year variable in the data` : ""}. They are listed under “Survey files not included”.`;
}

/* ---------- markers & selection ---------- */
const BOOKMARK = on => `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M4 1.6h8c.3 0 .5.2.5.5v12.1L8 11.2l-4.5 3V2.1c0-.3.2-.5.5-.5z" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

function markBtn(g) {
  const on = E.byGid.has(g);
  return `<button type="button" class="mark${on ? " on" : ""}" data-mark="${g}" aria-pressed="${on}" title="${on ? "Remove from export" : "Add to export"}" aria-label="${on ? "Remove from export" : "Add to export"}">${BOOKMARK(on)}</button>`;
}
function exportToggle(g) {
  const on = E.byGid.has(g);
  return `<button type="button" class="btn small xtoggle${on ? " on" : ""}" data-mark="${g}" aria-pressed="${on}">${BOOKMARK(on)}<span>${on ? "In export list" : "Add to export"}</span></button>`;
}

function toggleExport(g) {
  if (E.byGid.has(g)) removeItem(g); else addItem(newItem(g));
  refreshMarks();
}
function addItem(it) { if (E.byGid.has(it.gid)) return; E.items.push(it); E.byGid.set(it.gid, it); E.dirty = true; }
function removeItem(g) { E.items = E.items.filter(i => i.gid !== g); E.byGid.delete(g); E.dirty = true; }

function refreshMarks() {
  document.querySelectorAll("[data-mark]").forEach(b => {
    const on = E.byGid.has(+b.dataset.mark);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on);
    const t = on ? "Remove from export" : "Add to export";
    if (b.classList.contains("xtoggle")) b.innerHTML = BOOKMARK(on) + `<span>${on ? "In export list" : "Add to export"}</span>`;
    else { b.innerHTML = BOOKMARK(on); b.title = t; b.setAttribute("aria-label", t); }
  });
  const n = E.items.length;
  $("#exCount").textContent = n;
  $("#exCount").hidden = n === 0;
}

/* ---------- question data ---------- */
async function occFor(g) {
  if (!E.occ.has(g)) {
    const shard = await getShard(S.idx.shard[g]);
    E.occ.set(g, shard[g].map(o => ({ o, key: occKey(o), dkey: `${S.meta.files[o[0]][7]}|${o[1]}`, ...fileInfo(o[0]) })));
  }
  return E.occ.get(g);
}
const itemOcc = (it, occ) => it.progs ? occ.filter(r => it.progs.includes(r.pidx)) : occ;
const nDatasets = list => new Set(list.map(r => r.fid)).size;
const byPlace = (a, b) => a.country.localeCompare(b.country) || String(a.year).localeCompare(String(b.year)) || String(a.wave || "").localeCompare(String(b.wave || "")) || a.prog.localeCompare(b.prog);

async function loadKeys() {
  if (!E.keys) E.keys = await loadGz("keys.json.gz");
  return E.keys;
}

/* ---------- export view ---------- */
function initExport() {
  E.doc = defaultDoc();
  E.stemFid = new Map(S.meta.files.map((f, i) => [f[7], i]));
  refreshMarks();
  window.addEventListener("beforeunload", e => {
    if (E.items.length && E.dirty) { e.preventDefault(); e.returnValue = ""; }
  });
  const v = $("#exportView");
  v.addEventListener("click", onExportClick);
  v.addEventListener("change", onExportChange);
  v.addEventListener("input", onExportInput);
  v.addEventListener("mousemove", e => { const t = e.target.closest("[data-tip]"); tipAt(e, t ? esc(t.dataset.tip) : null); });
  v.addEventListener("mouseleave", () => tipAt(null, null));
}

function showMsg(type, html) {
  E.msg = type ? { type, html } : null;
  const el = $("#exMsg");
  if (!el) return;
  el.hidden = !E.msg;
  el.className = `ex-msg ${type || ""}`;
  el.innerHTML = html || "";
}

function renderExport() {
  const d = E.doc, n = E.items.length, nExcl = (S.meta.excluded || []).length;
  $("#exportView").innerHTML = `
  <div class="ex-wrap">
    <div class="ex-head">
      <div>
        <h2>Export</h2>
        <p class="muted">Add questions with the bookmark marker <span class="mark-inline">${BOOKMARK(false)}</span> in <a href="#">Search</a> or <a href="#v=programmes">Survey programmes</a>, choose what to include for each, and compile a Word document. Nothing is saved in the browser: use <b>Save overview source</b> to keep your selection and settings, and load the file here next time.</p>
      </div>
      <div class="ex-actions">
        <label class="btn" tabindex="0">Load saved overview source<input type="file" id="exLoad" accept=".json,application/json" hidden></label>
        <button type="button" class="btn" id="exSave"${n ? "" : " disabled"}>Save overview source</button>
        <button type="button" class="btn primary" id="exCompile"${n ? "" : " disabled"}>Compile information to Word</button>
      </div>
    </div>
    <div id="exMsg" class="ex-msg" hidden></div>

    <section class="card ex-doc">
      <h3>Document</h3>
      <div class="ex-grid2">
        <label class="field"><span>Title</span><input type="text" id="exTitle" value="${esc(d.title)}"></label>
        <label class="field"><span>Subtitle</span><input type="text" id="exSubtitle" value="${esc(d.subtitle)}" placeholder="Optional"></label>
      </div>
      <label class="toggle big"><input type="checkbox" id="exIncMeth"${d.includeMethodology ? " checked" : ""}> Include the methodology description on the first page</label>
      <div class="ex-meth"${d.includeMethodology ? "" : " hidden"}>
        <textarea id="exMeth" rows="18" spellcheck="true">${esc(d.methodology)}</textarea>
        <div class="ex-hint">Edit the text as you like. Blank lines separate paragraphs, lines starting with “## ” become subheadings and lines starting with “- ” become bullet points.
          <button type="button" class="linkbtn" id="exMethReset">Reset to the default text</button></div>
      </div>
      <label class="toggle big"><input type="checkbox" id="exIncExcl"${d.includeExcluded ? " checked" : ""}> Include the list of survey files not included in the dictionary (${fmt(nExcl)} files, with reasons)</label>
      <label class="toggle big"><input type="checkbox" id="exIncSum"${d.includeSummary ? " checked" : ""}> Include a summary table of the selected questions</label>
      <p class="note">Word format: A4, Times New Roman 12 pt, 1.5 line spacing (tables in smaller type). Each question starts on a new page and always lists its source files and survey documentation links.</p>
    </section>

    <section class="card">
      <h3>Selected questions <span class="muted" style="font-weight:400">${n}</span><span class="spacer"></span>
        ${n ? `<button type="button" class="btn small" data-xall="open">Expand all</button><button type="button" class="btn small" data-xall="close">Collapse all</button><button type="button" class="btn small" data-xall="clear">Remove all</button>` : ""}</h3>
      ${n ? `<p class="muted" style="margin:0 0 10px">Click a question to choose its programmes, the content to include, the answer distributions and a comment.</p><ol class="exlist" id="exList"></ol>`
          : `<p class="muted">No questions selected yet. Use the bookmark marker ${BOOKMARK(false)} at the top right of a question in the result list, or “Add to export” on a question’s page.</p>`}
    </section>
  </div>`;
  renderList();
  if (E.msg) showMsg(E.msg.type, E.msg.html);
}

function renderList() {
  const list = $("#exList");
  if (!list) return;
  list.innerHTML = E.items.map((it, i) => `<li class="exi${it.open ? " open" : ""}" data-g="${it.gid}">
      <div class="exi-head">
        <button type="button" class="exi-tg" data-x="toggle" aria-expanded="${it.open}">
          <span class="exi-num">${i + 1}</span>
          <span class="exi-txt"><b>${esc(S.idx.label[it.gid])}</b><span class="muted exi-sum">${esc(itemSummary(it))}</span></span>
          <span class="chev" aria-hidden="true">▸</span>
        </button>
        <div class="exi-btns">
          <button type="button" class="btn small" data-x="up" title="Move up"${i === 0 ? " disabled" : ""} aria-label="Move up">↑</button>
          <button type="button" class="btn small" data-x="down" title="Move down"${i === E.items.length - 1 ? " disabled" : ""} aria-label="Move down">↓</button>
          <button type="button" class="btn small" data-x="remove">Remove</button>
        </div>
      </div>
      ${it.open ? `<div class="exi-body" id="exb-${it.gid}"><div class="loading">Loading question…</div></div>` : ""}
    </li>`).join("");
  E.items.filter(it => it.open).forEach(fillBody);
}

function itemSummary(it) {
  const parts = [`${fmt(S.idx.n[it.gid])} datasets`];
  if (it.progs) {
    const asked = E.occ.has(it.gid) ? new Set(E.occ.get(it.gid).map(r => r.pidx)).size : null;
    parts.push(it.progs.length <= 3 ? `${it.progs.map(progCode).join(", ")} only` : `${it.progs.length}${asked ? ` of ${asked}` : ""} programmes`);
  }
  parts.push(it.dists.size ? `${it.dists.size} distribution${it.dists.size === 1 ? "" : "s"}` : "no distributions");
  if (!it.coverage) parts.push("no coverage table");
  if (it.comment.trim()) parts.push("comment");
  return parts.join(" · ");   // plain text
}

async function fillBody(it) {
  let occ;
  try { occ = await occFor(it.gid); }
  catch (e) { const el = $(`#exb-${it.gid}`); if (el) el.innerHTML = `<p class="err">Could not load this question: ${esc(e.message)}</p>`; return; }
  const el = $(`#exb-${it.gid}`);
  if (!el) return;
  const keepScroll = el.querySelector(".cov-wrap")?.scrollTop || 0;
  const progsAsked = [...new Set(occ.map(r => r.pidx))].sort((a, b) => progCode(a).localeCompare(progCode(b)));
  const scoped = itemOcc(it, occ);
  const inScope = new Set(scoped.map(r => r.dkey));
  const chosen = scoped.filter(r => it.dists.has(r.dkey)).sort(byPlace);
  const variants = new Set(occ.map(r => r.o[2] || S.idx.label[it.gid])).size;
  const outside = [...it.dists].filter(k => !inScope.has(k)).length;
  el.innerHTML = `
    <div class="exb-sec"><div class="exb-lbl">Programmes</div>
      <div class="exb-progs">${progsAsked.map(p => {
        const on = !it.progs || it.progs.includes(p);
        return `<label class="pchk${on ? " on" : ""}"><input type="checkbox" data-x="prog" value="${p}"${on ? " checked" : ""}> <b>${esc(progCode(p))}</b> <span class="muted">${fmt(nDatasets(occ.filter(r => r.pidx === p)))}</span></label>`;
      }).join("")}${progsAsked.length > 1 ? `<button type="button" class="linkbtn" data-x="progall">All programmes</button>` : ""}</div>
    </div>
    <div class="exb-sec"><div class="exb-lbl">Include</div>
      <div class="exb-incl">
        <label class="toggle"><input type="checkbox" data-x="coverage"${it.coverage ? " checked" : ""}> Country × year coverage table</label>
        <label class="toggle"><input type="checkbox" data-x="varnames"${it.varnames ? " checked" : ""}> Variable names</label>
        <label class="toggle"><input type="checkbox" data-x="variants"${it.variants ? " checked" : ""}${variants > 1 ? "" : " disabled"}> Label variants (${variants})</label>
      </div>
      <p class="note">Source file names and the survey documentation links (for exact question wording, codebooks and questionnaires) are always included.</p>
    </div>
    <div class="exb-sec"><div class="exb-lbl">Answer distributions</div>
      <div class="exb-tools">
        <span>Click countries and years in the table to include their answer distributions: <b>${chosen.length}</b> of ${fmt(scoped.length)} selected${outside ? ` <span class="muted">(${outside} more outside the selected programmes, left out)</span>` : ""}.</span>
        <button type="button" class="btn small" data-x="all">Select all</button>
        <button type="button" class="btn small" data-x="none">Deselect all</button>
        <label class="toggle"><input type="checkbox" data-x="exmiss"${it.excludeMissing ? " checked" : ""}> Exclude missing codes from %</label>
      </div>
      <div class="cov-wrap">${pickGrid(it, scoped)}</div>
      <div class="legend"><span><i style="background:var(--cell-2)"></i>asked (darker: more datasets)</span><span><i class="lg-pick"></i>distribution included</span><span><i class="lg-part"></i>some of the cell’s datasets included</span></div>
      ${chosen.length ? `<div class="chips exb-chosen">${chosen.map(r => `<span class="chip">${esc(r.country)} ${esc(r.year)}${r.wave ? ` (${esc(r.wave)})` : ""} · ${esc(r.prog)} · <code>${esc(r.o[1])}</code><button type="button" class="chip-x" data-x="rmd" data-d="${esc(r.dkey)}" aria-label="Remove">×</button></span>`).join("")}</div>` : ""}
    </div>
    <div class="exb-sec"><div class="exb-lbl">Comment</div>
      <textarea data-x="comment" rows="3" placeholder="Optional. Included in the document under this question.">${esc(it.comment)}</textarea>
    </div>`;
  const wrap = el.querySelector(".cov-wrap");
  if (wrap) wrap.scrollTop = keepScroll;
}

function pickGrid(it, scoped) {
  const years = [...new Set(scoped.map(r => r.year))].sort();
  const byC = new Map();
  for (const r of scoped) {
    if (!byC.has(r.iso)) byC.set(r.iso, { name: r.country, cells: new Map() });
    const cells = byC.get(r.iso).cells;
    if (!cells.has(r.year)) cells.set(r.year, []);
    cells.get(r.year).push(r);
  }
  const rows = [...byC.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  return `<table class="cov pick"><thead><tr><th></th>${years.map(y => `<th>${esc(y)}</th>`).join("")}</tr></thead><tbody>${rows.map(([iso, c]) =>
    `<tr><th title="${esc(c.name)}">${esc(c.name)}</th>${years.map(y => {
      const list = c.cells.get(y);
      if (!list) return "<td></td>";
      const k = list.filter(r => it.dists.has(r.dkey)).length;
      const state = k === list.length ? " pk" : k ? " pp" : "";
      const tip = `${c.name} ${y}: ${list.length} dataset${list.length === 1 ? "" : "s"}${k ? `, ${k} included` : ""} (${list.slice(0, 6).map(r => `${r.prog}${r.wave ? " " + r.wave : ""}`).join(", ")}${list.length > 6 ? ", …" : ""}). Click to ${k === list.length ? "remove" : "include"}.`;
      return `<td class="c${Math.min(3, list.length)}${state}" data-cell="${iso}|${esc(y)}" data-tip="${esc(tip)}"></td>`;
    }).join("")}</tr>`).join("")}</tbody></table>`;
}

function changed(it, { body = true } = {}) {
  E.dirty = true;
  const li = document.querySelector(`.exi[data-g="${it.gid}"]`);
  const sum = li?.querySelector(".exi-sum");
  if (sum) sum.textContent = itemSummary(it);
  if (body) fillBody(it);
}

function onExportClick(e) {
  const t = e.target;
  if (t.id === "exSave") return saveSource();
  if (t.id === "exCompile") return compileWord();
  if (t.id === "exMethReset") {
    if (!confirm("Replace the methodology text with the default text?")) return;
    E.doc.methodology = defaultMethodology(); $("#exMeth").value = E.doc.methodology; E.dirty = true; return;
  }
  const all = t.closest("[data-xall]")?.dataset.xall;
  if (all === "open" || all === "close") { E.items.forEach(it => it.open = all === "open"); return renderList(); }
  if (all === "clear") {
    if (!confirm(`Remove all ${E.items.length} questions from the export list?`)) return;
    E.items = []; E.byGid.clear(); E.dirty = true; refreshMarks(); return renderExport();
  }
  const li = t.closest(".exi");
  if (!li) return;
  const it = E.byGid.get(+li.dataset.g);
  const cell = t.closest("td[data-cell]");
  if (cell) {
    const [iso, y] = cell.dataset.cell.split("|");
    const list = itemOcc(it, E.occ.get(it.gid)).filter(r => r.iso === iso && r.year === y);
    const allOn = list.every(r => it.dists.has(r.dkey));
    list.forEach(r => allOn ? it.dists.delete(r.dkey) : it.dists.add(r.dkey));
    return changed(it);
  }
  const x = t.closest("[data-x]")?.dataset.x;
  const i = E.items.indexOf(it);
  if (x === "toggle") { it.open = !it.open; return renderList(); }
  if (x === "up" && i > 0) { [E.items[i - 1], E.items[i]] = [E.items[i], E.items[i - 1]]; E.dirty = true; return renderList(); }
  if (x === "down" && i < E.items.length - 1) { [E.items[i + 1], E.items[i]] = [E.items[i], E.items[i + 1]]; E.dirty = true; return renderList(); }
  if (x === "remove") { removeItem(it.gid); refreshMarks(); return renderExport(); }
  if (x === "all") { itemOcc(it, E.occ.get(it.gid)).forEach(r => it.dists.add(r.dkey)); return changed(it); }
  if (x === "none") { const sc = new Set(itemOcc(it, E.occ.get(it.gid)).map(r => r.dkey)); [...it.dists].forEach(k => sc.has(k) && it.dists.delete(k)); return changed(it); }
  if (x === "rmd") { it.dists.delete(t.closest("[data-d]").dataset.d); return changed(it); }
  if (x === "progall") { it.progs = null; return changed(it); }
}

function onExportChange(e) {
  const t = e.target;
  if (t.id === "exLoad") { const f = t.files[0]; t.value = ""; if (f) loadSource(f); return; }
  if (t.id === "exIncMeth") { E.doc.includeMethodology = t.checked; $(".ex-meth").hidden = !t.checked; E.dirty = true; return; }
  if (t.id === "exIncExcl") { E.doc.includeExcluded = t.checked; E.dirty = true; return; }
  if (t.id === "exIncSum") { E.doc.includeSummary = t.checked; E.dirty = true; return; }
  const li = t.closest(".exi");
  if (!li) return;
  const it = E.byGid.get(+li.dataset.g);
  const x = t.dataset.x;
  if (x === "prog") {
    const asked = [...new Set(E.occ.get(it.gid).map(r => r.pidx))];
    const on = new Set(it.progs || asked);
    t.checked ? on.add(+t.value) : on.delete(+t.value);
    if (!on.size) { t.checked = true; return; }            // keep at least one programme
    it.progs = on.size === asked.length ? null : [...on].sort((a, b) => a - b);
    return changed(it);
  }
  if (x === "coverage" || x === "varnames" || x === "variants") { it[x] = t.checked; return changed(it, { body: false }); }
  if (x === "exmiss") { it.excludeMissing = t.checked; return changed(it, { body: false }); }
}

function onExportInput(e) {
  const t = e.target;
  if (t.id === "exTitle") { E.doc.title = t.value; E.dirty = true; return; }
  if (t.id === "exSubtitle") { E.doc.subtitle = t.value; E.dirty = true; return; }
  if (t.id === "exMeth") { E.doc.methodology = t.value; E.dirty = true; return; }
  if (t.dataset.x === "comment") {
    const it = E.byGid.get(+t.closest(".exi").dataset.g);
    it.comment = t.value;
    changed(it, { body: false });
  }
}

/* ---------- save / load the overview source ---------- */
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
const slug = s => (s || "survey-overview").trim().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "survey-overview";

async function saveSource() {
  if (!E.items.length) return;
  let keys;
  try { keys = await loadKeys(); }
  catch (e) { return showMsg("err", `Could not save: the question keys could not be loaded (${esc(e.message)}).`); }
  const data = {
    format: SOURCE_FORMAT,
    version: SOURCE_VERSION,
    saved: new Date().toISOString(),
    dataBuilt: S.meta.built,
    site: location.origin + location.pathname,
    document: { ...E.doc },
    questions: E.items.map(it => ({
      key: keys[it.gid],
      label: S.idx.label[it.gid],
      id: it.gid,
      programmes: it.progs ? it.progs.map(progCode) : null,
      include: { coverage: it.coverage, variableNames: it.varnames, labelVariants: it.variants },
      excludeMissing: it.excludeMissing,
      comment: it.comment,
      distributions: [...it.dists].map(d => { const i = d.indexOf("|"); return { dataset: d.slice(0, i), variable: d.slice(i + 1) }; }),
    })),
  };
  download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `${slug(E.doc.title)}_overview-source.json`);
  E.dirty = false;
  showMsg("ok", `Saved the overview source (${data.questions.length} question${data.questions.length === 1 ? "" : "s"}). Load this file in the Export tab to continue later.`);
}

// Returns a list of problems; empty when the file has the expected structure.
function validateSource(d) {
  const p = [];
  const isObj = x => x && typeof x === "object" && !Array.isArray(x);
  if (!isObj(d)) return ["the file does not contain a JSON object"];
  if (d.format !== SOURCE_FORMAT) p.push(`“format” must be “${SOURCE_FORMAT}”`);
  if (typeof d.version !== "number" || d.version > SOURCE_VERSION) p.push(`unsupported “version” (${esc(String(d.version))})`);
  if (!isObj(d.document)) p.push("“document” settings are missing");
  else {
    for (const k of ["title", "subtitle", "methodology"]) if (d.document[k] != null && typeof d.document[k] !== "string") p.push(`document.${k} must be text`);
    for (const k of ["includeMethodology", "includeExcluded", "includeSummary"]) if (d.document[k] != null && typeof d.document[k] !== "boolean") p.push(`document.${k} must be true or false`);
  }
  if (!Array.isArray(d.questions)) p.push("“questions” must be a list");
  else d.questions.forEach((q, i) => {
    const at = `question ${i + 1}`;
    if (!isObj(q)) { p.push(`${at} is not an object`); return; }
    if (typeof q.key !== "string" || !q.key) p.push(`${at}: “key” is missing`);
    if (typeof q.label !== "string") p.push(`${at}: “label” is missing`);
    if (q.programmes != null && !(Array.isArray(q.programmes) && q.programmes.every(x => typeof x === "string"))) p.push(`${at}: “programmes” must be a list of programme codes or null`);
    if (q.include != null && !isObj(q.include)) p.push(`${at}: “include” must be an object`);
    if (q.comment != null && typeof q.comment !== "string") p.push(`${at}: “comment” must be text`);
    if (q.distributions != null && !(Array.isArray(q.distributions) && q.distributions.every(x => isObj(x) && typeof x.dataset === "string" && typeof x.variable === "string")))
      p.push(`${at}: “distributions” must be a list of {dataset, variable}`);
  });
  return p;
}

async function loadSource(file) {
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { return showMsg("err", `<b>${esc(file.name)}</b> could not be read: it is not a valid JSON file.`); }
  const problems = validateSource(data);
  if (problems.length) {
    return showMsg("err", `<b>${esc(file.name)}</b> is not a valid Survey Dictionary overview source:<ul>${problems.slice(0, 8).map(x => `<li>${x}</li>`).join("")}</ul>${problems.length > 8 ? `<p>…and ${problems.length - 8} more problems.</p>` : ""}`);
  }
  if (E.items.length && !confirm(`Replace the current export list (${E.items.length} questions) and document settings with the contents of “${file.name}”?`)) return;
  showMsg("info", "Loading the overview source…");

  // Question ids change between data builds: use the id only for the same build, otherwise the key.
  const sameBuild = data.dataBuilt === S.meta.built;
  let keyIndex = null;
  const resolve = async q => {
    if (sameBuild && Number.isInteger(q.id) && S.idx.label[q.id] === q.label) return q.id;
    if (!keyIndex) { const keys = await loadKeys(); keyIndex = new Map(keys.map((k, i) => [k, i])); }
    return keyIndex.get(q.key);
  };
  const codeIdx = new Map(S.meta.progs.map((p, i) => [p[0], i]));
  const items = [], missing = [];
  let droppedDists = 0, droppedProgs = 0;
  for (const q of data.questions) {
    let g;
    try { g = await resolve(q); }
    catch (e) { return showMsg("err", `Could not load the question keys (${esc(e.message)}).`); }
    if (g == null || items.some(it => it.gid === g)) { if (g == null) missing.push(q.label); continue; }
    const it = newItem(g);
    if (Array.isArray(q.programmes)) {
      const ps = q.programmes.map(c => codeIdx.get(c)).filter(x => x != null);
      droppedProgs += q.programmes.length - ps.length;
      it.progs = ps.length ? ps.sort((a, b) => a - b) : null;
    }
    const inc = q.include || {};
    it.coverage = inc.coverage !== false; it.varnames = inc.variableNames !== false; it.variants = inc.labelVariants !== false;
    it.excludeMissing = q.excludeMissing === true;
    it.comment = q.comment || "";
    let occ;
    try { occ = await occFor(g); } catch { occ = []; }
    const valid = new Set(occ.map(r => r.dkey));
    for (const d of q.distributions || []) {
      const k = `${d.dataset}|${d.variable}`;
      if (valid.has(k)) it.dists.add(k); else droppedDists++;
    }
    if (it.progs) { const asked = new Set(occ.map(r => r.pidx)); it.progs = it.progs.filter(p => asked.has(p)); if (!it.progs.length || it.progs.length === asked.size) it.progs = null; }
    items.push(it);
  }
  const dd = data.document;
  E.doc = {
    ...defaultDoc(),
    ...Object.fromEntries(["title", "subtitle", "methodology", "includeMethodology", "includeExcluded", "includeSummary"].filter(k => dd[k] != null).map(k => [k, dd[k]])),
  };
  E.items = items; E.byGid = new Map(items.map(it => [it.gid, it]));
  E.dirty = false;
  refreshMarks();
  const notes = [];
  if (missing.length) notes.push(`${missing.length} question${missing.length === 1 ? " was" : "s were"} not found in the current data and left out: ${missing.slice(0, 5).map(l => `“${esc(l)}”`).join(", ")}${missing.length > 5 ? ", …" : ""}`);
  if (droppedDists) notes.push(`${droppedDists} selected distribution${droppedDists === 1 ? " is" : "s are"} no longer available and ${droppedDists === 1 ? "was" : "were"} left out`);
  if (droppedProgs) notes.push(`${droppedProgs} unknown programme code${droppedProgs === 1 ? "" : "s"} ignored`);
  E.msg = { type: notes.length ? "warn" : "ok", html: `Loaded <b>${esc(file.name)}</b>: ${items.length} question${items.length === 1 ? "" : "s"}${sameBuild ? "" : ` (saved with data built ${esc(String(data.dataBuilt || "unknown"))}, matched to the current data)`}.${notes.length ? `<ul>${notes.map(n => `<li>${n}</li>`).join("")}</ul>` : ""}` };
  renderExport();
}

/* ---------- Word document ---------- */
let docxPromise = null;
function loadDocx() {
  if (window.docx) return Promise.resolve(window.docx);
  if (!docxPromise) docxPromise = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = DOCX_URL;
    s.onload = () => window.docx ? res(window.docx) : rej(new Error("the Word library did not load"));
    s.onerror = () => { docxPromise = null; rej(new Error("the Word library could not be downloaded (are you online?)")); };
    document.head.appendChild(s);
  });
  return docxPromise;
}

const FONT = "Times New Roman";
const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1440, CONTENT_W = PAGE_W - 2 * MARGIN;  // A4 in twentieths of a point
const COV_FILL = ["A9CBF2", "5E9BE0", "1F5FAE"];

async function compileWord() {
  if (!E.items.length) return;
  const btn = $("#exCompile");
  if (btn) btn.disabled = true;
  try {
    showMsg("info", "Preparing the Word document: loading the Word library…");
    const D = await loadDocx();
    showMsg("info", "Preparing the Word document: loading questions…");
    for (const it of E.items) await occFor(it.gid);
    const children = [];
    const P = (text, opts = {}) => new D.Paragraph({ ...opts, children: [new D.TextRun({ text, ...(opts.run || {}) })] });
    const H = (text, level) => new D.Paragraph({ text, heading: level });

    // title page
    children.push(new D.Paragraph({ heading: D.HeadingLevel.TITLE, alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: E.doc.title || "Survey question overview" })] }));
    if (E.doc.subtitle.trim()) children.push(P(E.doc.subtitle.trim(), { alignment: D.AlignmentType.CENTER, run: { size: 28 }, spacing: { after: 240 } }));
    children.push(new D.Paragraph({
      alignment: D.AlignmentType.CENTER, spacing: { after: 360 },
      children: [new D.TextRun({ text: `Compiled ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} from the Survey Dictionary (`, size: 20, italics: true }),
        new D.ExternalHyperlink({ link: location.origin + location.pathname, children: [new D.TextRun({ text: location.origin + location.pathname, style: "Hyperlink", size: 20, italics: true })] }),
        new D.TextRun({ text: `), data built ${S.meta.built}. ${E.items.length} question${E.items.length === 1 ? "" : "s"}.`, size: 20, italics: true })],
    }));
    if (E.doc.includeMethodology && E.doc.methodology.trim()) {
      children.push(H("Methodology", D.HeadingLevel.HEADING_1));
      children.push(...textBlocks(D, E.doc.methodology));
    }
    if (E.doc.includeExcluded && (S.meta.excluded || []).length) children.push(...excludedSection(D));
    if (E.doc.includeSummary) children.push(...summarySection(D));

    // one section per question
    let done = 0;
    for (const [i, it] of E.items.entries()) {
      showMsg("info", `Preparing the Word document: question ${i + 1} of ${E.items.length}…`);
      children.push(...await questionSection(D, it, i));
      done++;
    }
    const doc = new D.Document({
      creator: "Survey Dictionary", title: E.doc.title, description: E.doc.subtitle,
      styles: docStyles(D),
      numbering: { config: [{ reference: "bullets", levels: [{ level: 0, format: D.LevelFormat.BULLET, text: "•", alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
      sections: [{
        properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
        footers: { default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ children: [D.PageNumber.CURRENT], size: 20 })] })] }) },
        children,
      }],
    });
    const blob = await D.Packer.toBlob(doc);
    download(blob, `${slug(E.doc.title)}.docx`);
    showMsg("ok", `Compiled <b>${esc(slug(E.doc.title))}.docx</b> with ${done} question${done === 1 ? "" : "s"}. Remember to <b>save the overview source</b> if you want to change it later.`);
  } catch (e) {
    console.error(e);
    showMsg("err", `The Word document could not be compiled: ${esc(e.message)}`);
  } finally {
    const b = $("#exCompile");
    if (b) b.disabled = !E.items.length;
  }
}

function docStyles(D) {
  const h = (size, before = 240) => ({ run: { font: FONT, size, bold: true, color: "000000" }, paragraph: { spacing: { before, after: 120, line: 360 } } });
  return {
    default: {
      document: { run: { font: FONT, size: 24 }, paragraph: { spacing: { line: 360, after: 120 } } },   // 12 pt, 1.5 spacing
      title: { run: { font: FONT, size: 40, bold: true, color: "000000" }, paragraph: { spacing: { before: 0, after: 200, line: 360 } } },
      heading1: h(32, 360), heading2: h(26), heading3: { ...h(24, 180), run: { font: FONT, size: 24, bold: true, italics: true, color: "000000" } },
      hyperlink: { run: { color: "1F5FAE", underline: { type: "single" } } },
    },
    paragraphStyles: [
      { id: "TableText", name: "Table text", basedOn: "Normal", run: { font: FONT, size: 17 }, paragraph: { spacing: { line: 240, before: 0, after: 0 } } },
      { id: "Small", name: "Small text", basedOn: "Normal", run: { font: FONT, size: 20 }, paragraph: { spacing: { line: 276, before: 0, after: 80 } } },
    ],
  };
}

// Methodology text: blank lines separate paragraphs, "## " subheadings, "# " headings, "- " bullets
function textBlocks(D, text) {
  const out = [];
  for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").map(l => l.trimEnd()).filter(l => l.trim());
    let para = [];
    const flush = () => { if (para.length) out.push(new D.Paragraph({ children: [new D.TextRun(para.join(" "))] })); para = []; };
    for (const l of lines) {
      if (/^##\s+/.test(l)) { flush(); out.push(new D.Paragraph({ text: l.replace(/^##\s+/, ""), heading: D.HeadingLevel.HEADING_2 })); }
      else if (/^#\s+/.test(l)) { flush(); out.push(new D.Paragraph({ text: l.replace(/^#\s+/, ""), heading: D.HeadingLevel.HEADING_1 })); }
      else if (/^\s*[-•*]\s+/.test(l)) { flush(); out.push(new D.Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new D.TextRun(l.replace(/^\s*[-•*]\s+/, ""))] })); }
      else para.push(l.trim());
    }
    flush();
  }
  return out;
}

// simple table: header row + rows of cell texts (or {text, link}), relative column widths
function simpleTable(D, header, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const w = widths.map(x => Math.floor(CONTENT_W * x / total));
  const cell = (c, i, head) => new D.TableCell({
    width: { size: w[i], type: D.WidthType.DXA },
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    shading: head ? { fill: "E8E8E4", type: D.ShadingType.CLEAR, color: "auto" } : undefined,
    children: [new D.Paragraph({
      style: "TableText",
      children: c && typeof c === "object" && c.link
        ? [new D.ExternalHyperlink({ link: c.link, children: [new D.TextRun({ text: c.text, style: "Hyperlink" })] })]
        : [new D.TextRun({ text: String(c ?? ""), bold: head })],
    })],
  });
  return new D.Table({
    width: { size: w.reduce((a, b) => a + b, 0), type: D.WidthType.DXA }, columnWidths: w, layout: D.TableLayoutType.FIXED,
    rows: [new D.TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, i, true)) }),
      ...rows.map(r => new D.TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) }))],
  });
}

function excludedSection(D) {
  const ex = S.meta.excluded;
  return [
    new D.Paragraph({ text: "Survey files not included", heading: D.HeadingLevel.HEADING_2 }),
    new D.Paragraph({ children: [new D.TextRun(`Of the ${fmt(S.meta.mappingFiles || 0)} survey data files listed in the mapping files, the following ${fmt(ex.length)} did not produce any dataset in the dictionary.`)] }),
    simpleTable(D, ["Programme", "Survey file", "Year range", "Wave / round", "Reason"],
      ex.map(e => [e[0], e[1], e[2] || "", (e[3] || "").replace(/^(year|wave|round)_/, ""), e[4]]), [13, 25, 11, 13, 38]),
    new D.Paragraph({ children: [] }),
  ];
}

function scopedStats(it) {
  const occ = itemOcc(it, E.occ.get(it.gid));
  const years = [...new Set(occ.map(r => parseInt(r.year, 10)).filter(Boolean))].sort((a, b) => a - b);
  const progs = new Map();
  for (const r of occ) { if (!progs.has(r.prog)) progs.set(r.prog, new Set()); progs.get(r.prog).add(r.fid); }
  return { occ, nds: nDatasets(occ), nc: new Set(occ.map(r => r.iso)).size, y0: years[0], y1: years[years.length - 1], progs };
}

function summarySection(D) {
  const rows = E.items.map((it, i) => {
    const s = scopedStats(it);
    return [String(i + 1), S.idx.label[it.gid], fmt(s.nds), String(s.nc), s.y0 ? yrs(s.y0, s.y1) : "", [...s.progs.keys()].join(", ")];
  });
  return [
    new D.Paragraph({ text: "Selected questions", heading: D.HeadingLevel.HEADING_1, pageBreakBefore: true }),
    simpleTable(D, ["#", "Question", "Datasets", "Countries", "Years", "Programmes"], rows, [5, 45, 10, 10, 12, 18]),
  ];
}

async function questionSection(D, it, i) {
  const g = it.gid, s = scopedStats(it), occ = s.occ, all = E.occ.get(g);
  const out = [new D.Paragraph({ text: `${i + 1}. ${S.idx.label[g]}`, heading: D.HeadingLevel.HEADING_1, pageBreakBefore: true })];
  const progTxt = [...s.progs.entries()].map(([p, f]) => `${p} (${f.size})`).join(", ");
  let intro = `Asked in ${fmt(s.nds)} dataset${s.nds === 1 ? "" : "s"} in ${s.nc} ${s.nc === 1 ? "country" : "countries"}${s.y0 ? `, ${yrs(s.y0, s.y1)}` : ""}, in ${s.progs.size === 1 ? "the programme" : "the programmes"} ${progTxt}.`;
  if (it.progs) {
    const other = [...new Set(all.filter(r => !it.progs.includes(r.pidx)).map(r => r.prog))];
    if (other.length) intro += ` Only these programmes are included; the question also appears in ${other.join(", ")}.`;
  }
  out.push(new D.Paragraph({ children: [new D.TextRun(intro)] }));

  if (it.varnames) {
    const vn = new Map();
    for (const r of occ) vn.set(r.o[1], (vn.get(r.o[1]) || 0) + 1);
    const names = [...vn].sort((a, b) => b[1] - a[1]).map(([v]) => v);
    out.push(new D.Paragraph({ children: [new D.TextRun({ text: "Variable names: ", bold: true }), new D.TextRun(names.slice(0, 40).join(", ") + (names.length > 40 ? `, and ${names.length - 40} more` : ""))] }));
  }
  if (it.variants) {
    const vm = new Map();
    for (const r of occ) { const l = r.o[2] || S.idx.label[g]; vm.set(l, (vm.get(l) || 0) + 1); }
    if (vm.size > 1) {
      const vs = [...vm].sort((a, b) => b[1] - a[1]);
      out.push(new D.Paragraph({ text: "Label variants", heading: D.HeadingLevel.HEADING_3 }));
      vs.slice(0, 20).forEach(([l, n]) => out.push(new D.Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new D.TextRun(`${l} (${n})`)] })));
      if (vs.length > 20) out.push(new D.Paragraph({ children: [new D.TextRun({ text: `…and ${vs.length - 20} more variants.`, italics: true })] }));
    }
  }
  if (it.comment.trim()) {
    out.push(new D.Paragraph({ text: "Comment", heading: D.HeadingLevel.HEADING_3 }));
    it.comment.trim().split(/\n\s*\n/).forEach(p => out.push(new D.Paragraph({ children: [new D.TextRun(p.replace(/\s*\n\s*/g, " "))] })));
  }
  if (it.coverage) {
    out.push(new D.Paragraph({ text: "Coverage by country and year", heading: D.HeadingLevel.HEADING_2 }));
    out.push(...coverageTables(D, occ));
    out.push(new D.Paragraph({ style: "Small", spacing: { before: 80 }, children: [new D.TextRun({ text: "Shaded cells: the question was asked in that country and year. Numbers give the number of datasets when there are several (for example several survey waves in one year).", italics: true })] }));
  }
  const chosen = occ.filter(r => it.dists.has(r.dkey)).sort(byPlace);
  if (chosen.length) {
    out.push(new D.Paragraph({ text: "Answer distributions", heading: D.HeadingLevel.HEADING_2 }));
    out.push(new D.Paragraph({ style: "Small", children: [new D.TextRun({ text: `Unweighted percentages of respondents${it.excludeMissing ? ", excluding missing and non-substantive codes" : "; grey bars are missing or non-substantive codes"}.`, italics: true })] }));
    for (const r of chosen) {
      out.push(new D.Paragraph({ keepNext: true, spacing: { before: 200, after: 0 }, children: [new D.TextRun({ text: `${r.country}, ${r.year}${r.wave ? ` (wave ${r.wave})` : ""} – ${r.progName}`, bold: true })] }));
      out.push(new D.Paragraph({ style: "Small", keepNext: true, children: [new D.TextRun(`Variable ${r.o[1]}${r.o[2] ? `: ${r.o[2]}` : ""}${r.o[3] != null ? ` · N valid ${fmt(r.o[3])}` : ""} · Source file: ${r.src || "unknown"}`)] }));
      const imgs = await distImages(r, it.excludeMissing);
      if (!imgs.length) out.push(new D.Paragraph({ children: [new D.TextRun({ text: "No distribution stored for this variable.", italics: true })] }));
      imgs.forEach((img, k) => out.push(new D.Paragraph({ keepNext: k < imgs.length - 1, spacing: { after: k < imgs.length - 1 ? 0 : 120 },
        children: [new D.ImageRun({ type: "svg", data: img.svg, fallback: { type: "png", data: img.png }, transformation: { width: img.w, height: img.h } })] })));
    }
  }
  out.push(...sourcesSection(D, occ));
  return out;
}

// country x year tables; years split over several tables so each fits the page width
function coverageTables(D, occ) {
  const years = [...new Set(occ.map(r => r.year))].sort();
  const byC = new Map();
  for (const r of occ) {
    if (!byC.has(r.iso)) byC.set(r.iso, { name: r.country, cells: new Map() });
    const cells = byC.get(r.iso).cells;
    cells.set(r.year, (cells.get(r.year) || new Set()).add(r.fid));
  }
  const rows = [...byC.values()].sort((a, b) => a.name.localeCompare(b.name));
  const PER = 16, countryW = 2100, yearW = Math.floor((CONTENT_W - countryW) / PER);
  const out = [];
  for (let s = 0; s < years.length; s += PER) {
    const ys = years.slice(s, s + PER);
    const cell = (text, opts = {}) => new D.TableCell({
      width: { size: opts.w || yearW, type: D.WidthType.DXA }, verticalAlign: D.VerticalAlign.CENTER,
      margins: { top: 20, bottom: 20, left: 30, right: 30 },
      shading: opts.fill ? { fill: opts.fill, type: D.ShadingType.CLEAR, color: "auto" } : undefined,
      children: [new D.Paragraph({ style: "TableText", alignment: opts.left ? D.AlignmentType.LEFT : D.AlignmentType.CENTER,
        children: [new D.TextRun({ text, size: opts.size || 14, bold: opts.bold, color: opts.color })] })],
    });
    if (years.length > PER) out.push(new D.Paragraph({ style: "Small", spacing: { before: 120 }, children: [new D.TextRun({ text: `Years ${ys[0]}–${ys[ys.length - 1]}`, bold: true })] }));
    out.push(new D.Table({
      width: { size: countryW + yearW * ys.length, type: D.WidthType.DXA }, columnWidths: [countryW, ...ys.map(() => yearW)], layout: D.TableLayoutType.FIXED,
      rows: [
        new D.TableRow({ tableHeader: true, children: [cell("Country", { w: countryW, left: true, bold: true, size: 15 }), ...ys.map(y => cell(String(y), { bold: true, size: 13 }))] }),
        ...rows.map(c => new D.TableRow({ cantSplit: true, children: [cell(c.name, { w: countryW, left: true, size: 15 }), ...ys.map(y => {
          const n = c.cells.get(y)?.size || 0;
          return n ? cell(n > 1 ? String(n) : "", { fill: COV_FILL[Math.min(3, n) - 1], color: "FFFFFF", bold: true, size: 13 }) : cell("");
        })] })),
      ],
    }));
  }
  return out;
}

function sourcesSection(D, occ) {
  const groups = new Map();
  for (const r of occ) {
    const k = `${r.prog}|${r.src}|${r.url}`;
    if (!groups.has(k)) groups.set(k, { prog: r.prog, src: r.src, url: r.url, years: new Set(), countries: new Set(), vars: new Set(), waves: new Set() });
    const gr = groups.get(k);
    gr.years.add(parseInt(r.year, 10)); gr.countries.add(r.country); gr.vars.add(r.o[1]); if (r.wave) gr.waves.add(r.wave);
  }
  const rows = [...groups.values()].sort((a, b) => a.prog.localeCompare(b.prog) || Math.min(...a.years) - Math.min(...b.years)).map(gr => {
    const ys = [...gr.years].filter(Boolean).sort((a, b) => a - b);
    const cs = [...gr.countries].sort();
    return [gr.prog, gr.src || "unknown",
      (ys.length ? (ys.length > 4 ? `${ys[0]}–${ys[ys.length - 1]} (${ys.length} years)` : ys.join(", ")) : "") + (gr.waves.size ? `; wave ${[...gr.waves].slice(0, 4).join(", ")}${gr.waves.size > 4 ? ", …" : ""}` : ""),
      cs.length > 3 ? `${cs.length} countries` : cs.join(", "),
      [...gr.vars].slice(0, 4).join(", ") + (gr.vars.size > 4 ? ", …" : ""),
      gr.url ? { text: gr.url, link: gr.url } : "no link recorded"];
  });
  return [
    new D.Paragraph({ text: "Source files and survey documentation", heading: D.HeadingLevel.HEADING_2 }),
    new D.Paragraph({ children: [new D.TextRun("For the exact question wording, codebooks and questionnaires, consult the survey documentation linked for each source file.")] }),
    simpleTable(D, ["Programme", "Source file", "Years", "Countries", "Variable", "Documentation (codebooks and questionnaires)"], rows, [14, 21, 15, 13, 10, 27]),
  ];
}

/* ---------- distribution charts as images (same design as on the site) ---------- */
// One or more images per distribution: long value lists are split into chunks so no image is taller than a page.
const ROWS_PER_IMAGE = 40;
async function distImages(r, excludeMissing) {
  const d = r.o[4];
  if (!d) return [];
  let rows = (d.r || []).map(([v, l, n]) => ({ v, l, n: n || 0, miss: isMissing(v, l) }));
  if (excludeMissing) rows = rows.filter(x => !x.miss);
  const histTotal = d.h ? d.h[2].reduce((a, b) => a + b, 0) : 0;
  const total = rows.reduce((a, x) => a + x.n, 0) + histTotal + (excludeMissing ? 0 : (d.o || 0));
  const max = Math.max(1, ...rows.map(x => x.n));   // same bar scale across chunks
  const out = [];
  const nChunks = Math.max(1, Math.ceil(rows.length / ROWS_PER_IMAGE));
  for (let k = 0; k < nChunks; k++) {
    const part = rows.slice(k * ROWS_PER_IMAGE, (k + 1) * ROWS_PER_IMAGE);
    if (!part.length && !(k === 0 && d.h)) continue;
    out.push(await drawDist(part, { d: k === 0 ? d : { ...d, h: null }, total, histTotal, max, note: k === nChunks - 1 && d.o && !excludeMissing }));
  }
  return out;
}

// The chart is laid out once as a list of shapes (bars with rounded corners, text), then rendered
// as SVG for Word (vector, sharp at any zoom) and as PNG, the fallback Word needs for versions
// without SVG support.
const CHART_FONT = '"Times New Roman", Times, serif';
let measureCtx = null;
function textWidth(text, size, weight = "normal") {
  measureCtx ||= document.createElement("canvas").getContext("2d");
  measureCtx.font = `${weight} ${size}px ${CHART_FONT}`;
  return measureCtx.measureText(text).width;
}
function fitText(text, maxW, size) {
  if (textWidth(text, size) <= maxW) return text;
  let t = text;
  while (t.length > 1 && textWidth(t + "…", size) > maxW) t = t.slice(0, -1);
  return t + "…";
}

function layoutDist(rows, { d, total, histTotal, max, note }) {
  const W = 600, rowH = 19, histH = d.h ? 120 : 0;
  const H = 6 + histH + rows.length * rowH + (note ? 20 : 0) + 6;
  const shapes = [];
  const rect = (x, y, w, h, r, fill) => shapes.push({ kind: "rect", x, y, w, h, r, fill });
  const text = (x, y, s, o) => shapes.push({ kind: "text", x, y, s, size: 11, weight: "normal", style: "normal", fill: "#222", align: "left", baseline: "alphabetic", ...o });
  let y = 6;
  if (d.h) {
    const [lo, hi, bins] = d.h, bmax = Math.max(1, ...bins), bw = W / bins.length, ph = histH - 34;
    bins.forEach((b, i) => {
      const h = Math.max(b ? 1 : 0, ph * b / bmax);
      if (h) rect(i * bw + 1, y + ph - h, bw - 2, h, [3, 3, 0, 0], "#2a78d6");
    });
    const ly = y + ph + 14, o = { fill: "#555" };
    text(0, ly, num(lo), o);
    text(W, ly, num(hi), { ...o, align: "right" });
    text(W / 2, ly, `Unlabelled numeric values (${fmt(histTotal)} responses, ${pct(histTotal, total)})`, { ...o, align: "center" });
    y += histH;
  }
  const labelW = 250, barX = labelW + 10, pctW = 95, barW = W - barX - pctW - 8;
  for (const x of rows) {
    const cy = y + rowH / 2, mid = { baseline: "middle" };
    const name = x.l && x.l !== x.v ? `${x.v}  ${x.l}` : String(x.v);
    text(0, cy, fitText(name, labelW, 12.5), { ...mid, size: 12.5 });
    if (x.n) rect(barX, cy - 6.5, Math.max(1.5, barW * x.n / max), 13, [0, 3, 3, 0], x.miss ? "#b9b8b2" : "#2a78d6");
    text(W - 46, cy, pct(x.n, total), { ...mid, size: 12.5, weight: "bold", fill: "#111", align: "right" });
    text(W, cy, fmt(x.n), { ...mid, fill: "#666", align: "right" });
    y += rowH;
  }
  if (note) text(0, y + 10, `${fmt(d.o)} responses in other, less frequent values are not shown.`, { baseline: "middle", style: "italic", fill: "#666" });
  return { W, H, shapes };
}

// rectangle path with per-corner radii [top-left, top-right, bottom-right, bottom-left]
function roundedPath(x, y, w, h, r) {
  const [tl, tr, br, bl] = r.map(v => Math.max(0, Math.min(v, w / 2, h / 2)));
  return `M${x + tl},${y}H${x + w - tr}${tr ? `A${tr},${tr} 0 0 1 ${x + w},${y + tr}` : ""}V${y + h - br}${br ? `A${br},${br} 0 0 1 ${x + w - br},${y + h}` : ""}`
    + `H${x + bl}${bl ? `A${bl},${bl} 0 0 1 ${x},${y + h - bl}` : ""}V${y + tl}${tl ? `A${tl},${tl} 0 0 1 ${x + tl},${y}` : ""}Z`;
}

function distSvg({ W, H, shapes }) {
  const r2 = v => Math.round(v * 100) / 100;
  const xml = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const anchor = { left: "start", center: "middle", right: "end" };
  const body = shapes.map(s => s.kind === "rect"
    ? `<path d="${roundedPath(r2(s.x), r2(s.y), r2(s.w), r2(s.h), s.r)}" fill="${s.fill}"/>`
    : `<text x="${r2(s.x)}" y="${r2(s.y)}" font-size="${s.size}"${s.weight !== "normal" ? ` font-weight="${s.weight}"` : ""}${s.style !== "normal" ? ` font-style="${s.style}"` : ""} fill="${s.fill}" text-anchor="${anchor[s.align]}"${s.baseline === "middle" ? ` dominant-baseline="central"` : ""}>${xml(s.s)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${CHART_FONT}'><rect width="${W}" height="${H}" fill="#ffffff"/>${body}</svg>`;
}

async function distPng({ W, H, shapes }) {
  const scale = 3, c = document.createElement("canvas");
  c.width = W * scale; c.height = H * scale;
  const g = c.getContext("2d");
  g.scale(scale, scale);
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
  for (const s of shapes) {
    g.fillStyle = s.fill;
    if (s.kind === "rect") { g.fill(new Path2D(roundedPath(s.x, s.y, s.w, s.h, s.r))); continue; }
    g.font = `${s.style} ${s.weight} ${s.size}px ${CHART_FONT}`;
    g.textAlign = s.align; g.textBaseline = s.baseline;
    g.fillText(s.s, s.x, s.y);
  }
  const blob = await new Promise(res => c.toBlob(res, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

async function drawDist(rows, opts) {
  const chart = layoutDist(rows, opts);
  return { svg: new TextEncoder().encode(distSvg(chart)), png: await distPng(chart), w: chart.W, h: chart.H };
}
