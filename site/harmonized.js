"use strict";
/* Harmonized variables tab: maps of what has been coded and harmonized, so the coding can be followed.
   World map > region > country > subnational regions. Click a subnational region for the source data behind it,
   and a source for how its region codes were coded. Anything with no data is grey; darker blue means more respondents.
   Region codes that could not be coded stay off the map and are listed with their label from the file.
   Data: data/harmonized/ (aggregates from the survey harmonization project, no respondent-level rows). */

const HV = {
  index: null, world: null, files: new Map(), bound: false, hoverRegion: null,
  varId: null, level: "world", region: null, iso: null, wave: "all", unit: null, src: null,   // what is on screen (kept in the URL)
  d: null, shapes: null, names: new Map(), group: new Map(), scale: { all: [], wave: [] },
};
const HV_WORLD_VIEW = { lon_min: -180, lat_min: -58, lon_max: 180, lat_max: 84 };

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
const hvYear = w => String(w.date).slice(0, 4);
const hvMonth = w => new Date(w.date + "T00:00:00Z").toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" });
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
const hvVar = () => hvList(HV.index.variables).find(x => x.id === HV.varId);
const hvTotalsOfVar = () => hvList(HV.index.country_totals).filter(t => t.variable === HV.varId);
const hvCountryName = iso => (HV.index.countries || {})[iso] || (HV.world.countries.find(c => c.iso3 === iso) || {}).name || iso;
const hvCountryRegion = iso => (HV.world.countries.find(c => c.iso3 === iso) || {}).region;
const hvHref = (extra = {}) => "#" + new URLSearchParams({ v: "harmonized", var: HV.varId, ...extra }).toString();

/* ---------- color classes: darker means more ---------- */
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
const hvScaleOf = values => ({ breaks: hvBreaks(values), max: Math.max(0, ...values) });
const hvClassOf = (n, sc) => hvClass(hvClassIndex(n, sc.breaks), sc.breaks.length + 1);

function hvTotals(cells) {
  const m = new Map();
  for (const c of cells) if (c.unit) { const r = hvRegion(c.unit); m.set(r, (m.get(r) || 0) + c.n); }
  return m;
}

function hvPrepareScale() {
  const perWave = new Map(), perGroup = new Map();
  for (const c of HV.d.cells) {
    if (!c.unit) continue;
    const k = c.wave + "|" + c.unit, g = HV.group.get(c.unit) || c.unit;
    perWave.set(k, (perWave.get(k) || 0) + c.n);
    perGroup.set(g, (perGroup.get(g) || 0) + c.n);
  }
  HV.scale = { wave: hvScaleOf([...perWave.values()]), all: hvScaleOf([...perGroup.values()]) };
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
  const p = {};
  if (HV.level === "region") p.r = HV.region;
  if (HV.level === "country") {
    p.c = HV.iso;
    if (!hvIsAll()) p.w = HV.wave;
    if (HV.unit) p.u = HV.unit;
    if (HV.src) p.src = HV.src;
  }
  history.replaceState(null, "", hvHref(p));
}

async function renderHarmonized(p) {
  const root = $("#harmonizedView");
  if (!HV.index) root.innerHTML = `<p class="loading">Loading…</p>`;
  try {
    [HV.index, HV.world] = await Promise.all([hvFile("index"), hvFile("world")]);
    const vars = hvList(HV.index.variables);
    HV.varId = (vars.find(x => x.id === p.get("var")) || vars[0]).id;
    const iso = p.get("c");
    HV.unit = HV.src = null;
    HV.wave = "all";
    if (iso && hvTotalsOfVar().some(t => t.iso3 === iso)) {
      HV.level = "country"; HV.iso = iso; HV.region = hvCountryRegion(iso);
      await hvLoadCountry();
      if (hvWave(p.get("w"))) HV.wave = p.get("w");
      HV.unit = p.get("u") || null;
      HV.src = p.get("src") || null;
    } else if (hvList(HV.world.regions).some(r => r.region === p.get("r"))) {
      HV.level = "region"; HV.region = p.get("r"); HV.iso = null;
    } else {
      HV.level = "world"; HV.region = null; HV.iso = null;
    }
    if (!HV.bound) { hvBind(root); HV.bound = true; }
    hvDraw();
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="hv-wrap"><p class="err">Could not load the harmonized variables (${esc(e.message)}).</p></div>`;
  }
}

/* ---------- page ---------- */
function hvDraw(refocus) {
  const root = $("#harmonizedView");
  const body = HV.level === "country" ? `${hvTimeControl()}<div id="hvBody">${hvCountryBody()}</div>` : hvWorldBody();
  root.innerHTML = `<div class="hv-wrap">
    <div class="pi-head"><h2>Harmonized variables</h2>
      <p class="muted">What has been coded and harmonized so far. Click through from the world to a country, then a region to see the source data behind it, then a source to see how its regions were coded.</p></div>
    ${hvControls()}
    ${hvVariableCard()}
    ${body}
  </div>`;
  hvSync();
  if (refocus) { const el = root.querySelector(refocus); if (el) el.focus({ preventScroll: true }); }
}

function hvControls() {
  const vars = hvList(HV.index.variables);
  const crumbs = [`<a href="${hvHref()}">World</a>`];
  if (HV.region) crumbs.push(HV.level === "region" ? `<b>${esc(HV.region)}</b>` : `<a href="${hvHref({ r: HV.region })}">${esc(HV.region)}</a>`);
  if (HV.level === "country") crumbs.push(`<b>${esc(hvCountryName(HV.iso))}</b>`);
  if (HV.level === "world") crumbs[0] = `<b>World</b>`;
  return `<div class="hv-controls">
    <label class="field"><span>Variable</span>
      <select id="hvVar">${vars.map(x => `<option value="${esc(x.id)}"${x.id === HV.varId ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
    <nav class="hv-crumbs" aria-label="Where you are">${crumbs.join(` <span aria-hidden="true">›</span> `)}</nav>
  </div>`;
}

function hvVariableCard() {
  const v = hvVar();
  const t = hvTotalsOfVar();
  const y0 = Math.min(...t.map(x => +x.first_year)), y1 = Math.max(...t.map(x => +x.last_year));
  return `<section class="card hv-var"><h3>${esc(v.name)}</h3>
    <p>${esc(v.wording)}</p>
    <p class="muted">Answers: ${esc(v.scale)}</p>
    <p class="muted">Asked in ${esc(hvList(v.programs).join(" and "))}, ${esc(y0)}–${esc(y1)}. Harmonized so far for ${t.length} ${t.length === 1 ? "country" : "countries"}.</p></section>`;
}

/* ---------- world and region views ---------- */
function hvWorldBody() {
  const totals = hvTotalsOfVar();
  const byIso = new Map(totals.map(t => [t.iso3, t]));
  const regions = hvList(HV.world.regions);
  const regionN = new Map(regions.map(r => [r.region, 0]));
  for (const t of totals) { const r = hvCountryRegion(t.iso3); if (regionN.has(r)) regionN.set(r, regionN.get(r) + t.n); }
  const inRegionView = HV.level === "region";
  const view = inRegionView ? regions.find(r => r.region === HV.region) : HV_WORLD_VIEW;
  const sc = inRegionView
    ? hvScaleOf(totals.filter(t => hvCountryRegion(t.iso3) === HV.region).map(t => t.n))
    : hvScaleOf([...regionN.values()].filter(n => n > 0));
  const k = inRegionView ? Math.cos(((+view.lat_min + +view.lat_max) / 2) * Math.PI / 180) : 0.8;
  const x0 = +view.lon_min * 100 * k, w = (+view.lon_max - +view.lon_min) * 100 * k;
  const y0 = -view.lat_max * 100, h = (+view.lat_max - +view.lat_min) * 100;
  const paths = HV.world.countries.map(c => {
    const name = esc(c.name);
    if (!inRegionView) {
      const n = regionN.get(c.region) || 0;
      return `<path class="hv-w ${n ? `hv-c${hvClassOf(n, sc)}` : "hv-no"}" data-region="${esc(c.region)}" data-name="${name}" d="${c.path}"></path>`;
    }
    const t = c.region === HV.region ? byIso.get(c.iso3) : null;
    if (t) return `<path class="hv-w hv-go hv-c${hvClassOf(t.n, sc)}" data-country="${esc(c.iso3)}" data-name="${name}" d="${c.path}" tabindex="0" role="link" aria-label="${name}: ${fmt(t.n)} respondents"></path>`;
    return `<path class="hv-w hv-no${c.region === HV.region ? "" : " hv-out"}" data-name="${name}" d="${c.path}"></path>`;
  }).join("");
  const title = inRegionView ? `${HV.region}: click a country` : "World: click a region";
  const sub = inRegionView
    ? `${fmt(regionN.get(HV.region) || 0)} respondents in this region`
    : `${fmt(totals.reduce((a, t) => a + t.n, 0))} respondents harmonized so far`;
  return `<div class="hv-main hv-main-world">
    <figure class="card hv-map hv-map-world">
      <figcaption><b>${esc(title)}</b><br><span class="muted">${esc(sub)}</span></figcaption>
      <svg viewBox="${x0} ${y0} ${w} ${h}" role="group" aria-label="${esc(title)}"><g transform="scale(${k} 1)">${paths}</g></svg>
      ${hvLegend(sc, inRegionView ? "No data yet" : "No data yet")}
      ${hvWorldCredit()}
    </figure>
    <aside class="card hv-panel">${inRegionView ? hvCountryList(byIso) : hvRegionList(regionN, byIso)}</aside>
  </div>`;
}

function hvRegionList(regionN, byIso) {
  const rows = [...regionN.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const count = r => [...byIso.keys()].filter(iso => hvCountryRegion(iso) === r).length;
  return `<h3>Regions</h3>
    <div class="hv-scroll"><table class="occ"><thead><tr><th>Region</th><th class="num">Countries with data</th><th class="num">Respondents</th></tr></thead>
    <tbody>${rows.map(([r, n]) => `<tr class="row" data-goregion="${esc(r)}" tabindex="0"><td>${esc(r)}</td><td class="num">${n ? count(r) : "–"}</td><td class="num">${n ? fmt(n) : `<span class="muted">No data yet</span>`}</td></tr>`).join("")}</tbody></table></div>`;
}

function hvCountryList(byIso) {
  const members = HV.world.countries.filter(c => c.region === HV.region);
  const withData = members.filter(c => byIso.has(c.iso3)).sort((a, b) => a.name.localeCompare(b.name));
  const others = members.length - withData.length;
  const table = `<div class="hv-scroll"><table class="occ"><thead><tr><th>Country</th><th class="num">Respondents</th><th class="num">Waves</th><th>Years</th></tr></thead>
    <tbody>${withData.map(c => { const t = byIso.get(c.iso3); return `<tr class="row" data-country="${esc(c.iso3)}" tabindex="0"><td>${esc(hvCountryName(c.iso3))}</td><td class="num">${fmt(t.n)}</td><td class="num">${t.waves}</td><td>${esc(t.first_year)}–${esc(t.last_year)}</td></tr>`; }).join("")}</tbody></table></div>`;
  return `<h3>${esc(HV.region)}</h3>
    ${withData.length ? table : `<p class="muted">No country in this region has data yet.</p>`}
    ${withData.length && others ? `<p class="muted hv-after">The other ${others} countries in this region have no data yet.</p>` : ""}`;
}

function hvWorldCredit() {
  const rows = HV.world.countries.slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<details class="hv-credit muted"><summary>Boundaries: <a href="https://www.geoboundaries.org/" rel="noopener">geoBoundaries</a>. Sources and licenses by country</summary>
    <p>Boundaries and names come from geoBoundaries and imply no position on disputed territory. Regions are the continents geoBoundaries gives each country.</p>
    <ul>${rows.map(c => `<li>${esc(c.name)}: ${esc(c.source)}. ${esc(c.license)}.</li>`).join("")}</ul></details>`;
}

/* ---------- country view ---------- */
function hvTimeControl() {
  const waves = HV.d.waves, i = waves.findIndex(w => w.wave_key === HV.wave);
  let lastYear = null;
  const ticks = waves.map((w, n) => {
    const y = hvYear(w), label = y !== lastYear ? y : "";
    lastYear = y;
    return `<span class="hv-tick" style="left:${waves.length > 1 ? (100 * n / (waves.length - 1)).toFixed(3) : 0}%">${esc(label)}</span>`;
  }).join("");
  return `<section class="card hv-time${i < 0 ? " idle" : ""}" id="hvTime">
    <button type="button" class="btn small" id="hvAllWaves" aria-pressed="${i < 0}">All waves</button>
    <div class="hv-slide">
      <div class="hv-now" id="hvNow" aria-live="polite">${esc(hvNowText())}</div>
      <input type="range" id="hvSlider" min="0" max="${waves.length - 1}" step="1" value="${Math.max(0, i)}" aria-label="Wave" aria-valuetext="${esc(hvNowText())}">
      <div class="hv-ticks" aria-hidden="true">${ticks}</div>
    </div>
  </section>`;
}

function hvNowText() {
  if (hvIsAll()) {
    const w = HV.d.waves;
    return `All ${w.length} waves, ${hvYear(w[0])}–${hvYear(w[w.length - 1])}. Move the slider to see one wave.`;
  }
  const w = hvWave(HV.wave);
  return `${hvWaveLabel(w)}, ${hvMonth(w)}`;
}

function hvCountryBody() {
  const totals = hvTotals(hvCellsInView());
  if (HV.unit && !totals.has(HV.unit)) HV.unit = null;
  return `<div class="hv-main">
      ${hvMap(totals)}
      <aside class="card hv-panel" aria-live="polite">${HV.src ? hvSourcePanel() : HV.unit ? hvRegionPanel(totals) : hvIntroPanel(totals)}</aside>
    </div>
    ${hvNotCoded()}
    ${hvRegionTable(totals)}`;
}

function hvRedrawBody(refocus) {
  const body = $("#hvBody");
  if (!body) return hvDraw(refocus);
  body.innerHTML = hvCountryBody();
  hvSync();
  if (refocus) { const el = $("#harmonizedView").querySelector(refocus); if (el) el.focus({ preventScroll: true }); }
}

function hvMap(totals) {
  const { shapes } = HV;
  const sc = hvIsAll() ? HV.scale.all : HV.scale.wave;
  const regions = [...totals.keys()].map(id => ({ id, n: totals.get(id), d: shapes.paths[id] })).filter(r => r.d);
  // The selected region is drawn last, so its outline sits on top of its neighbours.
  regions.sort((a, b) => (a.id === HV.unit) - (b.id === HV.unit));
  const paths = regions.map(r => `<path class="hv-r hv-c${hvClassOf(r.n, sc)}${r.id === HV.unit ? " sel" : ""}" data-unit="${esc(r.id)}" d="${r.d}" tabindex="0" role="button"
      aria-pressed="${r.id === HV.unit}" aria-label="${esc(hvName(r.id))}: ${fmt(r.n)} respondents"></path>`).join("");
  const onMap = [...totals.values()].reduce((a, b) => a + b, 0);
  const off = hvCellsInView().filter(c => !c.unit).reduce((a, c) => a + c.n, 0);
  const w = hvIsAll() ? null : hvWave(HV.wave);
  const title = w ? `${hvWaveLabel(w)}, ${hvYear(w)}: the regions as coded in this wave` : "All waves: regions that stay the same across every wave";
  return `<figure class="card hv-map">
    <figcaption><b>${esc(title)}</b><br><span class="muted">${fmt(onMap)} respondents on the map${off ? ` · ${fmt(off)} could not be coded (listed below)` : ""}</span></figcaption>
    <svg viewBox="${esc(shapes.view_box)}" role="group" aria-label="Map of ${esc(hvCountryName(HV.iso))}: respondents per region">
      <path class="hv-base" d="${shapes.outline}"></path>
      ${paths}
    </svg>
    ${hvLegend(sc, "No data")}
    ${hvCredit()}
  </figure>`;
}

function hvLegend(sc, none) {
  const count = sc.breaks.length + 1;
  const edges = [0, ...sc.breaks, sc.max];
  const items = [];
  if (sc.max) for (let i = 0; i < count; i++) {
    const lo = edges[i] + 1, hi = edges[i + 1];
    items.push(`<span class="hv-key"><i class="hv-sw hv-c${hvClass(i, count)}"></i>${lo === hi || count === 1 ? fmt(hi) : `${fmt(lo)}–${fmt(hi)}`}</span>`);
  }
  return `<div class="hv-legend" aria-label="Legend: respondents"><span class="hv-legend-title">Respondents</span>${items.join("")}<span class="hv-key"><i class="hv-sw hv-none"></i>${esc(none)}</span></div>`;
}

function hvCredit() {
  const c = HV.shapes.credit || {};
  return `<p class="hv-credit muted">Boundaries: <a href="${esc(c.url)}" rel="noopener">geoBoundaries</a> ${esc(c.boundary_id)}, ${esc(c.source)} (${esc(c.year)}). ${esc(c.license)}. ${esc(HV.index.note || "")}</p>`;
}

function hvIntroPanel(totals) {
  return `<h3>Click a region</h3>
    <p>You will see the source data that make it up, with the year and the number of respondents in each. Click a source to see how every region code in it was coded.</p>
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
    <div class="hv-scroll"><table class="occ"><thead><tr><th>Year</th><th>Source</th><th>Region variable</th><th>Code</th><th>Label in the file</th><th class="num">Respondents</th></tr></thead>
    <tbody>${rows.map(c => `<tr class="row" data-src="${esc(c.source)}" tabindex="0"><td>${esc(hvYear(hvWave(c.wave)))}</td><td>${esc(hvSourceLabel(c.source))}</td>
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
        return `<tr${mine ? ' class="on"' : ""}><td>${esc(r.code)}</td><td>${hvLabel(r.label)}</td><td class="num">${fmt(r.n)}</td><td>${coded}</td><td class="hv-why">${esc(r.rationale)}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  };
  const head = name => {
    const r = rows.find(x => x.var === name);
    return `<code>${esc(name)}</code> ${esc(r.var_label || "")}`;
  };
  return `<div class="hv-panel-head"><h3>How ${esc(hvSourceLabel(HV.src))}${w ? `, ${esc(hvYear(w))},` : ""} was coded</h3><button type="button" class="btn small" data-back>${HV.unit ? `Back to ${esc(hvName(HV.unit))}` : "Close"}</button></div>
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
    <div class="hv-scroll"><table class="occ"><thead><tr><th>Year</th><th>Source</th><th>Region variable</th><th>Code</th><th>Label in the file</th><th class="num">Respondents</th><th>Why</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="row" data-src="${esc(r.source)}" tabindex="0"><td>${esc(hvYear(hvWave(r.wave)))}</td><td>${esc(hvSourceLabel(r.source))}</td><td><code>${esc(r.var)}</code> ${esc(r.var_label || "")}</td><td>${esc(r.code)}</td><td>${hvLabel(r.label)}</td><td class="num">${fmt(r.n)}</td><td class="hv-why">${esc(r.reason || "")}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function hvRegionTable(totals) {
  const rows = [...totals.entries()].map(([id, n]) => ({ id, n, name: hvName(id) })).sort((a, b) => a.name.localeCompare(b.name));
  return `<section class="card hv-table"><h3>All regions in this view</h3>
    <div class="hv-scroll"><table class="occ"><thead><tr><th>Region</th><th class="num">Respondents</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="row${r.id === HV.unit ? " on" : ""}" data-unit="${esc(r.id)}" tabindex="0"><td>${esc(r.name)}</td><td class="num">${fmt(r.n)}</td></tr>`).join("")}</tbody></table></div></section>`;
}

/* ---------- events ---------- */
function hvSetWave(key) {
  HV.wave = key; HV.src = null;
  const t = $("#hvTime");
  if (t) t.classList.toggle("idle", hvIsAll());
  const all = $("#hvAllWaves");
  if (all) all.setAttribute("aria-pressed", String(hvIsAll()));
  const now = $("#hvNow");
  if (now) now.textContent = hvNowText();
  const sl = $("#hvSlider");
  if (sl) sl.setAttribute("aria-valuetext", hvNowText());
  hvRedrawBody();
}

function hvHoverRegion(region) {
  if (HV.hoverRegion === region) return;
  HV.hoverRegion = region;
  document.querySelectorAll("#harmonizedView path.hv-w.hover").forEach(p => p.classList.remove("hover"));
  if (region) document.querySelectorAll(`#harmonizedView path.hv-w[data-region="${CSS.escape(region)}"]`).forEach(p => p.classList.add("hover"));
}

function hvBind(root) {
  const act = target => {
    const region = target.closest("[data-region], [data-goregion]");
    if (region) { tipAt(null, null); location.hash = hvHref({ r: region.dataset.region || region.dataset.goregion }).slice(1); return true; }
    const country = target.closest("[data-country]");
    if (country) { tipAt(null, null); location.hash = hvHref({ c: country.dataset.country }).slice(1); return true; }
    const unit = target.closest("[data-unit]");
    if (unit) { HV.unit = unit.dataset.unit; HV.src = null; tipAt(null, null); hvRedrawBody(`path[data-unit="${CSS.escape(HV.unit)}"]`); return true; }
    const src = target.closest("[data-src]");
    if (src) { HV.src = src.dataset.src; hvRedrawBody(".hv-panel [data-back]"); return true; }
    return false;
  };
  root.addEventListener("click", e => {
    if (e.target.closest("summary, a")) return;
    if (act(e.target)) return;
    if (e.target.closest("#hvAllWaves")) return hvSetWave("all");
    if (e.target.closest("[data-back]")) { HV.src = null; return hvRedrawBody(); }
    if (e.target.closest("[data-clear]")) { HV.unit = null; HV.src = null; return hvRedrawBody(); }
  });
  root.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-unit], [data-src], [data-country], [data-goregion]")) { e.preventDefault(); act(e.target); }
  });
  root.addEventListener("input", e => {
    if (e.target.id === "hvSlider") hvSetWave(HV.d.waves[+e.target.value].wave_key);
  });
  root.addEventListener("change", e => {
    if (e.target.id === "hvVar") { HV.varId = e.target.value; location.hash = hvHref().slice(1); }
  });
  root.addEventListener("mousemove", e => {
    const u = e.target.closest("path[data-unit]");
    if (u) {
      const n = hvTotals(hvCellsInView()).get(u.dataset.unit) || 0;
      return tipAt(e, `<b>${esc(hvName(u.dataset.unit))}</b>${fmt(n)} respondents`);
    }
    if (e.target.closest(".hv-base")) return tipAt(e, "No data in this view");
    const w = e.target.closest("path.hv-w");
    if (w) {
      hvHoverRegion(w.dataset.region || null);
      if (w.dataset.region) {
        const n = hvTotalsOfVar().filter(t => hvCountryRegion(t.iso3) === w.dataset.region).reduce((a, t) => a + t.n, 0);
        return tipAt(e, `<b>${esc(w.dataset.region)}</b>${n ? `${fmt(n)} respondents` : "No data yet"}`);
      }
      const t = w.dataset.country ? hvTotalsOfVar().find(x => x.iso3 === w.dataset.country) : null;
      return tipAt(e, `<b>${esc(w.dataset.name)}</b>${t ? `${fmt(t.n)} respondents` : "No data yet"}`);
    }
    hvHoverRegion(null);
    tipAt(null, null);
  });
  root.addEventListener("mouseleave", () => { hvHoverRegion(null); tipAt(null, null); });
}
