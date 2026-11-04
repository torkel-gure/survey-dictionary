"use strict";
/* Harmonized variables tab: maps of what has been coded and harmonized, so the coding can be followed.
   Click a region for the source data behind it; click a source for how its region codes were coded.
   Region codes that could not be coded stay off the map and are listed with their label from the file.
   Data: data/harmonized/ (aggregates from the survey harmonization project, no respondent-level rows). */

const HV = {
  index: null, files: new Map(), bound: false,
  varId: null, iso: null, wave: "all", unit: null, src: null,   // what is on screen (kept in the URL)
  d: null, shapes: null, names: new Map(), group: new Map(), scale: { all: [], wave: [] },
};
// What a comparison with the old mapping file found for a region code.
const HV_LEGACY = {
  verifies: "agrees", contradicts: "disagrees", coarser: "old file is coarser",
  finer: "old file is finer", unknown_target: "old file points to an unknown unit",
};

const hvFile = name => {
  if (!HV.files.has(name)) HV.files.set(name, loadGz(`harmonized/${name}.json.gz`));
  return HV.files.get(name);
};
const hvList = x => x == null ? [] : [].concat(x);
const hvIsAll = () => HV.wave === "all";
const hvRegion = unit => hvIsAll() ? (HV.group.get(unit) || unit) : unit;
const hvName = id => HV.names.get(id) || id;
const hvWave = key => HV.d.waves.find(w => w.wave_key === key);
const hvWaveLabel = w => `${w.program} ${w.wave}`;
// Some region variables hold codes with no label: the code itself is what the file has.
const hvLabel = x => x ? esc(x) : `<span class="muted">no label in the file</span>`;
const hvCellsInView = () => hvIsAll() ? HV.d.cells : HV.d.cells.filter(c => c.wave === HV.wave);
const hvSubsample = src => (HV.d.coding.find(c => c.source === src) || {}).subsample || "";
const hvSourceWave = src => {
  const cell = HV.d.cells.find(c => c.source === src);
  return cell ? hvWave(cell.wave) : null;
};
const hvSourceLabel = src => {
  const w = hvSourceWave(src), sub = hvSubsample(src);
  return (w ? hvWaveLabel(w) : src) + (sub ? ` (${sub})` : "");
};

/* ---------- color classes ---------- */
// Up to five classes from the quantiles, rounded to two digits so the legend reads easily.
function hvBreaks(values) {
  const s = values.filter(x => x > 0).sort((a, b) => a - b);
  if (!s.length) return [];
  const round2 = x => { const m = 10 ** Math.max(0, Math.floor(Math.log10(x)) - 1); return Math.ceil(x / m) * m; };
  const out = [];
  for (const q of [0.2, 0.4, 0.6, 0.8]) {
    const b = round2(s[Math.min(s.length - 1, Math.floor(q * s.length))]);
    if (b < s[s.length - 1] && !out.includes(b)) out.push(b);
  }
  return out;
}
const hvClassIndex = (n, breaks) => { const i = breaks.findIndex(b => n <= b); return i < 0 ? breaks.length : i; };
// Fewer than five classes still spread across the whole ramp.
const hvClass = (i, count) => count <= 1 ? 3 : 1 + Math.round(i * 4 / (count - 1));

function hvTotals(cells) {
  const m = new Map();
  for (const c of cells) if (c.unit) { const r = hvRegion(c.unit); m.set(r, (m.get(r) || 0) + c.n); }
  return m;
}

function hvPrepareScale() {
  const d = HV.d;
  const perWave = new Map(), perGroup = new Map();
  for (const c of d.cells) {
    if (!c.unit) continue;
    const k = c.wave + "|" + c.unit, g = HV.group.get(c.unit) || c.unit;
    perWave.set(k, (perWave.get(k) || 0) + c.n);
    perGroup.set(g, (perGroup.get(g) || 0) + c.n);
  }
  HV.scale = {
    wave: { breaks: hvBreaks([...perWave.values()]), max: Math.max(0, ...perWave.values()) },
    all: { breaks: hvBreaks([...perGroup.values()]), max: Math.max(0, ...perGroup.values()) },
  };
}

/* ---------- loading ---------- */
async function hvLoadCountry() {
  const [d, shapes] = await Promise.all([hvFile(`${HV.varId}_${HV.iso}`), hvFile(`regions_${HV.iso}`)]);
  HV.d = d; HV.shapes = shapes;
  HV.names = new Map(d.units.map(u => [u.id, u.name]));
  HV.group = new Map(d.units.filter(u => u.all_waves).map(u => [u.id, u.all_waves]));
  hvPrepareScale();
}

function hvSync() {
  const p = new URLSearchParams({ v: "harmonized", var: HV.varId, c: HV.iso });
  if (!hvIsAll()) p.set("w", HV.wave);
  if (HV.unit) p.set("u", HV.unit);
  if (HV.src) p.set("src", HV.src);
  history.replaceState(null, "", "#" + p.toString());
}

async function renderHarmonized(p) {
  const root = $("#harmonizedView");
  if (!HV.index) root.innerHTML = `<p class="loading">Loading…</p>`;
  try {
    HV.index = await hvFile("index");
    const vars = hvList(HV.index.variables);
    const v = vars.find(x => x.id === p.get("var")) || vars[0];
    HV.varId = v.id;
    const countries = hvList(v.countries);
    HV.iso = countries.includes(p.get("c")) ? p.get("c") : countries[0];
    await hvLoadCountry();
    HV.wave = hvWave(p.get("w")) ? p.get("w") : "all";
    HV.unit = p.get("u") || null;
    HV.src = p.get("src") || null;
    if (!HV.bound) { hvBind(root); HV.bound = true; }
    hvDraw();
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="hv-wrap"><p class="err">Could not load the harmonized variables (${esc(e.message)}).</p></div>`;
  }
}

/* ---------- drawing ---------- */
function hvDraw(refocus) {
  const root = $("#harmonizedView");
  const v = hvList(HV.index.variables).find(x => x.id === HV.varId);
  const totals = hvTotals(hvCellsInView());
  if (HV.unit && !totals.has(HV.unit)) HV.unit = null;
  root.innerHTML = `<div class="hv-wrap">
    <div class="pi-head"><h2>Harmonized variables</h2>
      <p class="muted">What has been coded and harmonized so far. Click a region to see the source data behind it, then click a source to see how its regions were coded.</p></div>
    ${hvControls(v)}
    ${hvVariableCard(v)}
    <div class="hv-main">
      ${hvMap(totals)}
      <aside class="card hv-panel" aria-live="polite">${HV.src ? hvSourcePanel() : HV.unit ? hvRegionPanel(totals) : hvIntroPanel(totals)}</aside>
    </div>
    ${hvNotCoded()}
    ${hvRegionTable(totals)}
  </div>`;
  hvSync();
  if (refocus) { const el = root.querySelector(refocus); if (el) el.focus({ preventScroll: true }); }
}

function hvControls(v) {
  const vars = hvList(HV.index.variables);
  const countries = hvList(v.countries);
  return `<div class="hv-controls">
    <label class="field"><span>Variable</span>
      <select id="hvVar">${vars.map(x => `<option value="${esc(x.id)}"${x.id === HV.varId ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
    <div class="field"><span>Country</span>
      <div class="hv-seg" role="group" aria-label="Country">${countries.map(c => `<button type="button" data-iso="${esc(c)}" aria-pressed="${c === HV.iso}">${esc(HV.index.countries[c] || c)}</button>`).join("")}</div></div>
    <label class="field"><span>Wave</span>
      <select id="hvWavePick"><option value="all"${hvIsAll() ? " selected" : ""}>All waves</option>
        ${HV.d.waves.map(w => `<option value="${esc(w.wave_key)}"${w.wave_key === HV.wave ? " selected" : ""}>${esc(hvWaveLabel(w))}, ${esc(String(w.date).slice(0, 7))}</option>`).join("")}</select></label>
  </div>`;
}

function hvVariableCard(v) {
  const years = HV.d.waves.map(w => String(w.date).slice(0, 4));
  return `<section class="card hv-var"><h3>${esc(v.name)}</h3>
    <p>${esc(v.wording)}</p>
    <p class="muted">Answers: ${esc(v.scale)}</p>
    <p class="muted">Asked in ${esc(hvList(v.programs).join(" and "))}: ${HV.d.waves.length} waves, ${esc(years[0])}–${esc(years[years.length - 1])}.</p></section>`;
}

function hvMap(totals) {
  const { shapes } = HV;
  const sc = hvIsAll() ? HV.scale.all : HV.scale.wave;
  const count = sc.breaks.length + 1;
  const regions = [...totals.keys()].map(id => ({ id, n: totals.get(id), d: shapes.paths[id] })).filter(r => r.d);
  // The selected region is drawn last, so its outline sits on top of its neighbours.
  regions.sort((a, b) => (a.id === HV.unit) - (b.id === HV.unit));
  const [, , vw, vh] = String(shapes.view_box).split(" ").map(Number);
  const hatch = Math.max(vw, vh) / 90;
  const paths = regions.map(r => {
    const cls = hvClass(hvClassIndex(r.n, sc.breaks), count);
    return `<path class="hv-r hv-c${cls}${r.id === HV.unit ? " sel" : ""}" data-unit="${esc(r.id)}" d="${r.d}" tabindex="0" role="button"
      aria-pressed="${r.id === HV.unit}" aria-label="${esc(hvName(r.id))}: ${fmt(r.n)} respondents"></path>`;
  }).join("");
  const onMap = [...totals.values()].reduce((a, b) => a + b, 0);
  const off = hvCellsInView().filter(c => !c.unit).reduce((a, c) => a + c.n, 0);
  const w = hvIsAll() ? null : hvWave(HV.wave);
  const title = w ? `${hvWaveLabel(w)}: the regions as coded in this wave` : "All waves: regions that stay the same across every wave";
  return `<figure class="card hv-map">
    <figcaption><b>${esc(title)}</b><br><span class="muted">${fmt(onMap)} respondents on the map${off ? ` · ${fmt(off)} could not be coded (listed below)` : ""}</span></figcaption>
    <svg viewBox="${esc(shapes.view_box)}" role="group" aria-label="Map of ${esc(HV.index.countries[HV.iso] || HV.iso)}: respondents per region">
      <defs><pattern id="hvHatch" patternUnits="userSpaceOnUse" width="${hatch}" height="${hatch}" patternTransform="rotate(45)">
        <rect class="hv-hatch-bg" width="${hatch}" height="${hatch}"></rect><line class="hv-hatch-line" x1="0" y1="0" x2="0" y2="${hatch}" stroke-width="${hatch / 3}"></line></pattern></defs>
      <path class="hv-base" d="${shapes.outline}" fill="url(#hvHatch)"></path>
      ${paths}
    </svg>
    ${hvLegend(sc, count)}
    ${hvCredit()}
  </figure>`;
}

function hvLegend(sc, count) {
  if (!sc.max) return "";
  const edges = [0, ...sc.breaks, sc.max];
  const items = [];
  for (let i = 0; i < count; i++) {
    const lo = edges[i] + 1, hi = edges[i + 1];
    items.push(`<span class="hv-key"><i class="hv-sw hv-c${hvClass(i, count)}"></i>${lo === hi ? fmt(hi) : `${fmt(lo)}–${fmt(hi)}`}</span>`);
  }
  return `<div class="hv-legend" aria-label="Legend: respondents per region"><span class="hv-legend-title">Respondents</span>${items.join("")}<span class="hv-key"><i class="hv-sw hv-none"></i>None in this view</span></div>`;
}

function hvCredit() {
  const c = HV.shapes.credit || {};
  return `<p class="hv-credit muted">Boundaries: <a href="${esc(c.url)}" rel="noopener">geoBoundaries</a> ${esc(c.boundary_id)}, ${esc(c.source)} (${esc(c.year)}). ${esc(c.license)}. ${esc(HV.index.note || "")}</p>`;
}

function hvIntroPanel(totals) {
  return `<h3>Click a region</h3>
    <p>You will see the source data that make it up, with the number of respondents in each. Click a source to see how every region code in it was coded.</p>
    <p class="muted">${totals.size} regions in this view. You can also pick a region from the table below the map.</p>`;
}

function hvRegionPanel(totals) {
  const cells = hvCellsInView().filter(c => c.unit && hvRegion(c.unit) === HV.unit);
  const waves = new Set(cells.map(c => c.wave));
  const parts = [...new Set(cells.map(c => c.unit))].filter(u => u !== HV.unit);
  const order = new Map(HV.d.waves.map((w, i) => [w.wave_key, i]));
  const rows = cells.slice().sort((a, b) => order.get(a.wave) - order.get(b.wave) || a.source.localeCompare(b.source));
  return `<div class="hv-panel-head"><h3>${esc(hvName(HV.unit))}</h3><button type="button" class="btn small" data-clear>Close</button></div>
    <p><b>${fmt(totals.get(HV.unit))}</b> respondents in ${waves.size} ${waves.size === 1 ? "wave" : "waves"}.${parts.length ? ` <span class="muted">Coded as ${esc(parts.map(hvName).join(", "))} in some waves.</span>` : ""}</p>
    <p class="muted">Click a source to see how its regions were coded.</p>
    <div class="hv-scroll"><table class="occ"><thead><tr><th>Source</th><th>Region variable</th><th>Code</th><th>Label in the file</th><th class="num">Respondents</th></tr></thead>
    <tbody>${rows.map(c => `<tr class="row" data-src="${esc(c.source)}" tabindex="0"><td>${esc(hvSourceLabel(c.source))}<br><span class="muted">${esc(String(hvWave(c.wave).date).slice(0, 7))}</span></td>
      <td>${esc(c.var)}</td><td>${esc(c.code)}</td><td>${hvLabel(c.label)}</td><td class="num">${fmt(c.n)}</td></tr>`).join("")}</tbody></table></div>`;
}

function hvSourcePanel() {
  const rows = HV.d.coding.filter(c => c.source === HV.src);
  if (!rows.length) { HV.src = null; return HV.unit ? hvRegionPanel(hvTotals(hvCellsInView())) : hvIntroPanel(hvTotals(hvCellsInView())); }
  const w = hvSourceWave(HV.src);
  const vars = [...new Set(rows.map(r => r.var))];
  const used = vars.filter(x => rows.find(r => r.var === x).used);
  const other = vars.filter(x => !used.includes(x));
  const block = name => {
    const list = rows.filter(r => r.var === name);
    return `<div class="hv-scroll"><table class="occ"><thead><tr><th>Code</th><th>Label in the file</th><th class="num">Respondents</th><th>Coded as</th><th>Why</th></tr></thead>
      <tbody>${list.map(r => {
        const mine = HV.unit && r.unit && hvRegion(r.unit) === HV.unit;
        const coded = r.unit ? esc(r.unit_name || r.unit) : `<span class="hv-tag">Not coded</span>`;
        const legacy = r.legacy ? r.legacy.split(";").map(k => HV_LEGACY[k] || k).join(", ") : "no entry";
        return `<tr${mine ? ' class="on"' : ""}><td>${esc(r.code)}</td><td>${hvLabel(r.label)}</td><td class="num">${fmt(r.n)}</td><td>${coded}</td><td class="hv-why">${esc(r.rationale)}<br><span class="muted">Old mapping file: ${esc(legacy)}</span></td></tr>`;
      }).join("")}</tbody></table></div>`;
  };
  const head = name => {
    const r = rows.find(x => x.var === name);
    return `<code>${esc(name)}</code> ${esc(r.var_label || "")}`;
  };
  return `<div class="hv-panel-head"><h3>How ${esc(hvSourceLabel(HV.src))} was coded</h3><button type="button" class="btn small" data-back>${HV.unit ? `Back to ${esc(hvName(HV.unit))}` : "Close"}</button></div>
    ${w ? `<dl class="hv-meta">
      <dt>File</dt><dd>${esc(w.file)}${w.study ? ` (study ${esc(w.study)})` : ""}</dd>
      <dt>Fieldwork</dt><dd>${esc(w.date_min)} to ${esc(w.date_max)}, from the ${esc(w.date_basis)}</dd>
      <dt>Item</dt><dd><code>${esc(w.variable)}</code>, ${esc(w.question_ref)}${w.questionnaire_url ? ` · <a href="${esc(w.questionnaire_url)}" rel="noopener">questionnaire</a>` : ""}</dd>
    </dl>` : ""}
    ${used.map(n => `<h4>${head(n)} <span class="hv-tag used">Used for the map</span></h4>${block(n)}`).join("")}
    ${other.length ? `<details class="hv-more"><summary>${other.length} other region ${other.length === 1 ? "variable" : "variables"} in this source, not used for the map</summary>
      ${other.map(n => `<h4>${head(n)}</h4>${block(n)}`).join("")}</details>` : ""}`;
}

function hvNotCoded() {
  const rows = hvList(HV.d.not_coded).filter(r => hvIsAll() || r.wave === HV.wave);
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!rows.length) return `<section class="card hv-off"><h3>Not on the map</h3><p class="muted">Every respondent in this view has a region on the map.</p></section>`;
  return `<section class="card hv-off"><h3>Not on the map: could not be coded <span class="hv-tag">${fmt(total)} respondents</span></h3>
    <p class="muted">These respondents are kept in the data, but their region code could not be tied to a region with confidence. The label is shown as it stands in the file.</p>
    <div class="hv-scroll"><table class="occ"><thead><tr><th>Source</th><th>Region variable</th><th>Code</th><th>Label in the file</th><th class="num">Respondents</th><th>Why</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="row" data-src="${esc(r.source)}" tabindex="0"><td>${esc(hvSourceLabel(r.source))}</td><td><code>${esc(r.var)}</code> ${esc(r.var_label || "")}</td><td>${esc(r.code)}</td><td>${hvLabel(r.label)}</td><td class="num">${fmt(r.n)}</td><td class="hv-why">${esc(r.reason || "")}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function hvRegionTable(totals) {
  const rows = [...totals.entries()].map(([id, n]) => ({ id, n, name: hvName(id) })).sort((a, b) => a.name.localeCompare(b.name));
  return `<section class="card hv-table"><h3>All regions in this view</h3>
    <div class="hv-scroll"><table class="occ"><thead><tr><th>Region</th><th class="num">Respondents</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="row${r.id === HV.unit ? " on" : ""}" data-unit="${esc(r.id)}" tabindex="0"><td>${esc(r.name)}</td><td class="num">${fmt(r.n)}</td></tr>`).join("")}</tbody></table></div></section>`;
}

/* ---------- events ---------- */
function hvBind(root) {
  const act = target => {
    const unit = target.closest("[data-unit]");
    if (unit) { HV.unit = unit.dataset.unit; HV.src = null; tipAt(null, null); hvDraw(`path[data-unit="${CSS.escape(HV.unit)}"]`); return true; }
    const src = target.closest("[data-src]");
    if (src) { HV.src = src.dataset.src; hvDraw(".hv-panel [data-back]"); return true; }
    return false;
  };
  root.addEventListener("click", async e => {
    if (act(e.target)) return;
    if (e.target.closest("[data-back]")) { HV.src = null; return hvDraw(); }
    if (e.target.closest("[data-clear]")) { HV.unit = null; HV.src = null; return hvDraw(); }
    const iso = e.target.closest("[data-iso]");
    if (iso && iso.dataset.iso !== HV.iso) {
      HV.iso = iso.dataset.iso; HV.unit = null; HV.src = null;
      await hvLoadCountry();
      if (!hvIsAll() && !hvWave(HV.wave)) HV.wave = "all";
      hvDraw(`[data-iso="${HV.iso}"]`);
    }
  });
  root.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-unit], [data-src]")) { e.preventDefault(); act(e.target); }
  });
  root.addEventListener("change", async e => {
    if (e.target.id === "hvWavePick") { HV.wave = e.target.value; HV.src = null; hvDraw("#hvWavePick"); }
    if (e.target.id === "hvVar") { HV.varId = e.target.value; HV.unit = null; HV.src = null; await hvLoadCountry(); hvDraw("#hvVar"); }
  });
  root.addEventListener("mousemove", e => {
    const r = e.target.closest("path[data-unit]");
    if (r) {
      const n = hvTotals(hvCellsInView()).get(r.dataset.unit) || 0;
      return tipAt(e, `<b>${esc(hvName(r.dataset.unit))}</b>${fmt(n)} respondents`);
    }
    if (e.target.closest(".hv-base")) return tipAt(e, "No respondents in this view");
    tipAt(null, null);
  });
  root.addEventListener("mouseleave", () => tipAt(null, null));
}
