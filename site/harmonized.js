"use strict";
/* Harmonized variables tab: the harmonized time series and how they were coded.
   World map > region > country. A country page leads with its timelines: every variant of the harmonized
   series, by which questions it joins and by geographic level. Click a wave for its question and how the answers
   were coded; click a region for the source data behind it, and a source for how its region codes were coded.
   Anything with no data is grey; darker blue means more respondents. Region codes that could not be coded stay off
   the map and are listed with their label from the file.
   Data: data/harmonized/ (aggregates from the survey harmonization project; rows/ holds each respondent's file, row, coded answer and region, and nothing else). */

const HV = {
  index: null, world: null, files: new Map(), bound: false, hoverRegion: null,
  varId: null, level: "world", region: null, iso: null, t: null, wave: "all", unit: null, src: null,   // what is on screen (kept in the URL)
  d: null, shapes: null, tl: null, names: new Map(), group: new Map(), drawAs: new Map(), levelMaps: new Map(), programs: [], scale: { all: {}, wave: {} },
};
const HV_WORLD_VIEW = { lon_min: -180, lat_min: -58, lon_max: 180, lat_max: 84 };
const HV_CODED = { pro: "Protectionist", anti: "Not protectionist", dk: "Don't know", refused: "Refused", not_asked: "Not asked", other_missing: "Other missing" };
const HV_FORMS = { orig: "original scale", bin: "protectionist or not (1 or 0)" };
const HV_CHANGES = {
  dk_presentation: "How \"don't know\" is presented changes",
  mode: "The interview mode changes",
  definition: "The definitions given to respondents change",
  instrument: "Moves to another file series",
  program: "Moves to another program",
  format: "The answer format changes",
  has_midpoint: "A middle category appears or goes",
  nonresponse_detail: "The detail on nonresponse changes",
};

const hvFile = name => {
  if (!HV.files.has(name)) HV.files.set(name, loadGz(`harmonized/${name}.json.gz`));
  return HV.files.get(name);
};
const hvList = x => x == null ? [] : [].concat(x);
const hvIsAll = () => HV.wave === "all";
const hvName = id => HV.names.get(id) || id;
const hvWave = key => HV.d.waves.find(w => w.wave_key === key);
const hvWaveLabel = w => `${w.program} ${w.wave}`;
const hvYear = w => String(w.date).slice(0, 4);
const hvMonth = w => new Date(w.date + "T00:00:00Z").toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" });
// Some region variables hold codes with no label: the code itself is what the file has.
const hvLabel = x => x ? esc(x) : `<span class="muted">no label in the file</span>`;
const hvTlWaveKeys = () => hvList(HV.tl.waves);
const hvTlWaves = () => { const k = new Set(hvTlWaveKeys()); return HV.d.waves.filter(w => k.has(w.wave_key)); };
// A coded unit with no boundary of its own is drawn as the unit containing it.
const hvDrawn = unit => HV.drawAs.get(unit) || unit;
// The region a coded unit counts as in the selected timeline.
const hvRegion = unit => {
  if (HV.tl && HV.tl.level) {
    const r = (HV.levelMaps.get(HV.tl.level) || new Map()).get(unit) || null;
    return r && hvIsAll() ? hvTlGroup(r) : r;
  }
  return hvDrawn(hvIsAll() ? (HV.group.get(unit) || unit) : unit);
};
// When a level's regions change along a timeline, the "all waves" map joins the regions that overlap.
function hvTlGroup(region) {
  const t = HV.tl;
  if (!t._groups) t._groups = new Map(hvList(t.all_waves).map(x => [x.unit, x.group]));
  return t._groups.get(region) || region;
}
const hvCellsInView = () => {
  const k = new Set(hvTlWaveKeys());
  return HV.d.cells.filter(c => k.has(c.wave) && (hvIsAll() || c.wave === HV.wave));
};
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
  for (const c of cells) if (c.unit) { const r = hvRegion(c.unit); if (r) m.set(r, (m.get(r) || 0) + c.n); }
  return m;
}

// One scale for single waves and one for all waves of the selected timeline.
function hvPrepareScale() {
  const k = new Set(hvTlWaveKeys());
  const toRegion = u => HV.tl.level ? HV.levelMaps.get(HV.tl.level).get(u) : hvDrawn(HV.group.get(u) || u);
  const perWave = new Map(), perGroup = new Map();
  for (const c of HV.d.cells) {
    if (!c.unit || !k.has(c.wave)) continue;
    const single = HV.tl.level ? toRegion(c.unit) : hvDrawn(c.unit), key = c.wave + "|" + single;
    const g = HV.tl.level ? hvTlGroup(toRegion(c.unit)) : toRegion(c.unit);
    perWave.set(key, (perWave.get(key) || 0) + c.n);
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
  HV.drawAs = new Map(d.units.filter(u => u.draw_as).map(u => [u.id, u.draw_as]));
  HV.levelMaps = new Map(hvList(d.levels).map(l => [l.id, new Map(hvList(l.members).map(m => [m.fine, m.unit]))]));
  HV.programs = [...new Set(d.waves.map(w => w.program))];
}

const hvTimelines = () => hvList(HV.d.timelines);
// Opens on a fixed level before a mixed one, because a mixed timeline can leave only one region on the all-waves map.
// Among those, the most waves, and between equals, the most detailed level.
function hvPickTimeline(id) {
  const all = hvTimelines();
  const found = all.find(t => t.id === id);
  if (found) return found;
  return all.slice().sort((a, b) => (b.level ? 1 : 0) - (a.level ? 1 : 0) || b.n_waves - a.n_waves || b.n_units - a.n_units)[0];
}
function hvSelectTimeline(id) {
  HV.tl = hvPickTimeline(id);
  HV.t = HV.tl.id;
  if (!hvIsAll() && !hvTlWaveKeys().includes(HV.wave)) HV.wave = "all";
  hvPrepareScale();
}

function hvSync() {
  const p = {};
  if (HV.level === "export") p.x = 1;
  if (HV.level === "region") p.r = HV.region;
  if (HV.level === "country") {
    p.c = HV.iso;
    p.t = HV.t;
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
    HV.tl = null;
    if (p.get("x")) {
      HV.level = "export"; HV.iso = null; HV.region = null;
      await hxEnter(iso, p.get("t"), p.get("r"));
    } else if (iso && hvTotalsOfVar().some(t => t.iso3 === iso)) {
      HV.level = "country"; HV.iso = iso; HV.region = hvCountryRegion(iso);
      await hvLoadCountry();
      if (hvWave(p.get("w"))) HV.wave = p.get("w");
      hvSelectTimeline(p.get("t"));
      HV.unit = p.get("u") || null;
      HV.src = p.get("src") || null;
    } else if (hvList(HV.world.regions).some(r => r.region === p.get("r"))) {
      HV.level = "region"; HV.region = p.get("r"); HV.iso = null;
    } else {
      HV.level = "world"; HV.region = null; HV.iso = null;
    }
    if (!HV.bound) { hvBind(root); HV.bound = true; }
    hvDraw(HV.refocus);
    HV.refocus = null;
    // Going to another place starts at the top: the lists can sit far down the page.
    const place = [HV.level, HV.region, HV.iso].join("|");
    if (HV.place && HV.place !== place) window.scrollTo(0, 0);
    HV.place = place;
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="hv-wrap"><p class="err">Could not load the harmonized variables (${esc(e.message)}).</p></div>`;
  }
}

/* ---------- page ---------- */
function hvDraw(refocus) {
  const root = $("#harmonizedView");
  if (HV.level === "export") {
    root.innerHTML = `<div class="hv-wrap">
      <div class="pi-head"><h2>Export harmonized data</h2>
        <p class="muted">Pick the variables, countries and timelines you want. You get the data, one item and answer mapping, and one region mapping per country.</p></div>
      <nav class="hv-crumbs hx-crumbs" aria-label="Where you are"><a href="${hvHref()}">World</a> <span aria-hidden="true">›</span> <b>Export data</b></nav>
      <div id="hxBody">${hxBody()}</div>
    </div>`;
    hvSync();
    hxRefresh();
    return;
  }
  const body = HV.level === "country"
    ? `${hvTimelineChart()}${hvTimelineCard()}<div id="hvBody">${hvCountryBody()}</div>`
    : hvWorldBody();
  root.innerHTML = `<div class="hv-wrap">
    <div class="pi-head"><h2>Harmonized variables</h2>
      <p class="muted">The harmonized time series so far, and how they were coded. Choose a country from the lists, or click through the maps, to see its timelines.</p></div>
    ${hvControls()}
    ${hvVariableCard()}
    ${body}
  </div>`;
  if (HV.level === "country") hvMarkChart();
  hvSync();
  if (refocus) { const el = root.querySelector(refocus); if (el) el.focus({ preventScroll: true }); }
}

function hvControls() {
  const vars = hvList(HV.index.variables);
  const crumbs = [`<a href="${hvHref()}">World</a>`];
  if (HV.region) crumbs.push(HV.level === "region" ? `<b>${esc(HV.region)}</b>` : `<a href="${hvHref({ r: HV.region })}">${esc(HV.region)}</a>`);
  if (HV.level === "country") crumbs.push(`<b>${esc(hvCountryName(HV.iso))}</b>`);
  if (HV.level === "world") crumbs[0] = `<b>World</b>`;
  const regions = hvList(HV.world.regions).map(r => r.region).sort((a, b) => a.localeCompare(b));
  const withData = new Set(hvTotalsOfVar().map(t => t.iso3));
  const countryGroups = regions.map(r => {
    const cs = HV.world.countries.filter(c => c.region === r).sort((a, b) => withData.has(b.iso3) - withData.has(a.iso3) || a.name.localeCompare(b.name));
    return `<optgroup label="${esc(r)}">${cs.map(c => `<option value="${esc(c.iso3)}"${withData.has(c.iso3) ? "" : " disabled"}${c.iso3 === HV.iso ? " selected" : ""}>${esc(c.name)}${withData.has(c.iso3) ? "" : " (no data yet)"}</option>`).join("")}</optgroup>`;
  }).join("");
  return `<div class="hv-controls">
    <label class="field"><span>Variable</span>
      <select id="hvVar">${vars.map(x => `<option value="${esc(x.id)}"${x.id === HV.varId ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
    <label class="field"><span>World region</span>
      <select id="hvRegionPick"><option value="">All regions</option>${regions.map(r => `<option value="${esc(r)}"${r === HV.region ? " selected" : ""}>${esc(r)}</option>`).join("")}</select></label>
    <label class="field"><span>Country</span>
      <select id="hvCountryPick"><option value="">Choose a country</option>${countryGroups}</select></label>
    <nav class="hv-crumbs" aria-label="Where you are">${crumbs.join(` <span aria-hidden="true">›</span> `)}</nav>
    <a class="btn" id="hvExport" href="${hvHref({ x: 1, ...(HV.level === "country" ? { c: HV.iso, t: HV.t } : HV.level === "region" ? { r: HV.region } : {}) })}">Export data</a>
  </div>`;
}

/* Regions and countries as a list, for anyone who would rather not click the map. */
function hvBrowse(byIso) {
  const inRegion = HV.level === "region";
  const regionTotal = r => hvTotalsOfVar().filter(t => hvCountryRegion(t.iso3) === r).reduce((a, t) => a + t.n, 0);
  const regions = (inRegion ? [HV.region] : hvList(HV.world.regions).map(r => r.region))
    .sort((a, b) => regionTotal(b) - regionTotal(a) || a.localeCompare(b));
  const col = r => {
    const cs = HV.world.countries.filter(c => c.region === r).sort((a, b) => byIso.has(b.iso3) - byIso.has(a.iso3) || a.name.localeCompare(b.name));
    return `<div class="hv-browse-col">${inRegion ? "" : `<h4><a href="${hvHref({ r })}">${esc(r)}</a></h4>`}
      <ul>${cs.map(c => byIso.has(c.iso3)
        ? `<li><a href="${hvHref({ c: c.iso3 })}">${esc(hvCountryName(c.iso3))}</a> <span class="muted">${fmt(byIso.get(c.iso3).n)}</span></li>`
        : `<li class="hv-nodata">${esc(c.name)}</li>`).join("")}</ul></div>`;
  };
  return `<section class="card hv-browse"><h3>${inRegion ? `Countries in ${esc(HV.region)}` : "All regions and countries"}</h3>
    <p class="muted">Countries with data are links, with their respondents beside them. Grey names have no data yet.</p>
    <div class="hv-browse-grid${inRegion ? " one" : ""}">${regions.map(col).join("")}</div></section>`;
}

function hvVariableCard() {
  const v = hvVar();
  const t = hvTotalsOfVar();
  const y0 = Math.min(...t.map(x => +x.first_year)), y1 = Math.max(...t.map(x => +x.last_year));
  const versions = +v.wordings === 1 ? "one wording" : `${v.wordings} versions of the wording`;
  const answersOpen = HV.level === "country" && hvList(HV.d.answers).some(a => a.status === "proposed");
  const regionsOpen = HV.level === "country" && hvList(HV.d.coding).some(c => c.status === "proposed");
  const tag = answersOpen ? "Coding proposed, not yet confirmed" : regionsOpen ? "Region coding proposed, not yet confirmed" : "";
  return `<section class="card hv-var"><h3>${esc(v.name)}${tag ? ` <span class="hv-tag">${tag}</span>` : ""}</h3>
    <p>${esc(v.definition)}.</p>
    <p class="muted">Asked in ${esc(hvList(v.programs).join(" and "))}, ${esc(y0)}–${esc(y1)}, with ${esc(versions)} and ${esc(v.scales)} answer scales. Harmonized so far for ${t.length} ${t.length === 1 ? "country" : "countries"}.${HV.level === "country" ? "" : " Open a country to see every question and how it was coded."}</p></section>`;
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
      ${hvLegend(sc, "No data yet")}
      ${hvWorldCredit()}
    </figure>
    <aside class="card hv-panel">${inRegionView ? hvCountryList(byIso) : hvRegionList(regionN, byIso)}</aside>
  </div>
  ${hvBrowse(byIso)}`;
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
  return `<details class="hv-credit muted"><summary>Boundaries: <a href="https://www.geoboundaries.org/" rel="noopener">geoBoundaries</a> and <a href="https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units" rel="noopener">Eurostat GISCO</a>. © EuroGeographics for the administrative boundaries. Sources and licenses by country</summary>
    <p>World boundaries and names come from geoBoundaries and imply no position on disputed territory. Regions are the continents geoBoundaries gives each country. Some regional boundaries in Europe come from Eurostat GISCO, each named on its country's map.</p>
    <ul>${rows.map(c => `<li>${esc(c.name)}: ${esc(c.source)}. ${esc(c.license)}.</li>`).join("")}</ul></details>`;
}

/* ---------- timelines: the variants of the harmonized series ---------- */
const hvTlYears = t => { const a = String(t.start).slice(0, 4), b = String(t.end).slice(0, 4); return a === b ? a : `${a}–${b}`; };
const hvProgramOf = key => key.split(":")[0];
const hvChangesAt = (t, wave) => {
  const c = hvList(t.changes).find(x => x.wave === wave);
  return c ? hvList(c.kinds) : [];
};
// What changes at a wave, in words. Moves between EB and ClimateEB files show in the marker's shape, so they raise no flag.
const hvChangeTexts = kinds => kinds.map(k => {
  if (HV_CHANGES[k]) return HV_CHANGES[k];
  const r = hvList(HV.d.recodes).find(x => x.event_id === k);
  return r ? `Region coding: ${String(r.notes).split(/(?<=\.)\s/)[0]}` : k;
});
const hvFlagKinds = kinds => kinds.filter(k => k !== "instrument" && k !== "program");
function hvLevelSeq(t) {
  const seq = [];
  for (const k of hvList(t.waves)) { const n = hvWave(k).fine_units; if (seq[seq.length - 1] !== n) seq.push(n); }
  return seq;
}
const hvRegionsText = n => `${n} ${n === 1 ? "region" : "regions"}`;
const hvIsJoined = t => t.scheme === "stable" || String(t.scheme).startsWith("joined-");
const hvTlTitle = t => t.level ? hvRegionsText(t.n_units) : `Finest in each wave`;
const hvTlSub = t => t.level ? t.level_label : `${hvLevelSeq(t).join(", then ")} regions`;

function hvTimelineChart() {
  const waves = HV.d.waves;
  const y0 = +hvYear(waves[0]), y1 = +hvYear(waves[waves.length - 1]) + 1;
  const T0 = Date.UTC(y0, 0, 1), T1 = Date.UTC(y1, 0, 1);
  const pct = d => (100 * (Date.parse(d + "T00:00:00Z") - T0) / (T1 - T0)).toFixed(2);
  const years = []; for (let y = y0; y < y1; y++) years.push(y);
  const axis = years.map(y => `<span class="hv-ax" style="left:${pct(`${y}-01-01`)}%">${y}</span>`).join("");
  const grid = years.map(y => `<i class="hv-gl" style="left:${pct(`${y}-01-01`)}%"></i>`).join("");
  const groups = new Map();
  for (const t of hvTimelines()) {
    const key = hvList(t.instruments).join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const order = [...groups.values()].sort((a, b) => hvList(b[0].instruments).length - hvList(a[0].instruments).length || Math.max(...b.map(t => t.n_waves)) - Math.max(...a.map(t => t.n_waves)));
  const row = t => {
    const keys = hvList(t.waves), ws = keys.map(hvWave);
    const dots = ws.map(w => {
      const flag = hvFlagKinds(hvChangesAt(t, w.wave_key)).length > 0;
      return `<button type="button" class="hv-dot hv-p${HV.programs.indexOf(w.program)}${flag ? " chg" : ""}" style="left:${pct(w.date)}%" data-wave="${esc(w.wave_key)}" aria-label="${esc(hvWaveLabel(w))}, ${esc(hvMonth(w))}"></button>`;
    }).join("");
    const a = pct(ws[0].date), b = pct(ws[ws.length - 1].date);
    return `<div class="hv-tl-row" data-timeline="${esc(t.id)}">
      <button type="button" class="hv-tl-label" data-pick="${esc(t.id)}"><b>${esc(hvTlTitle(t))}</b> <span>${esc(hvTlSub(t))}</span><br><span class="muted">${t.n_waves} waves, ${esc(hvTlYears(t))}</span></button>
      <div class="hv-tl-track">${grid}<i class="hv-tl-line" style="left:${a}%;width:${(b - a).toFixed(2)}%"></i>${dots}</div>
    </div>`;
  };
  const head = g => {
    const inGroup = new Set(g.flatMap(t => hvList(t.waves).map(hvProgramOf)));
    const programs = HV.programs.filter(p => inGroup.has(p));
    const same = hvList(g[0].instruments).length > 1;
    return `<div class="hv-tl-group"><b>${esc(programs.join(" and "))}</b> <span class="muted">${same ? "The same question across programs, checked in the questionnaires" : "One instrument: the same item in every wave"}</span></div>`;
  };
  const coded = waves.map(w => `<span class="hv-num" style="left:${pct(w.date)}%" data-codedwave="${esc(w.wave_key)}">${esc(w.fine_units)}</span>`).join("");
  const key = HV.programs.map((p, i) => `<span class="hv-key"><i class="hv-dot-key hv-p${i}"></i>${esc(p)}</span>`).join("");
  return `<section class="card hv-tl" id="hvTimelines">
    <h3>Timelines in ${esc(hvCountryName(HV.iso))}</h3>
    <p class="muted">Each row is one way this variable can be followed over time: which questions it joins, and at which level of geography. A level only reaches the waves that can be expressed at it. Click a row to see it on the map, or a wave for its question and how its answers were coded.</p>
    <div class="hv-tl-scroll"><div class="hv-tl-inner">
      <div class="hv-tl-row hv-tl-axis"><div class="hv-tl-label"></div><div class="hv-tl-track">${axis}</div></div>
      <div class="hv-tl-row hv-tl-coded"><div class="hv-tl-label"><b>Regions coded in each wave</b><br><span class="muted">The finest the files allow</span></div><div class="hv-tl-track">${grid}${coded}</div></div>
      ${order.map(g => head(g) + g.slice().sort((a, b) => String(a.start).localeCompare(String(b.start)) || (b.level ? 1 : 0) - (a.level ? 1 : 0) || b.n_units - a.n_units).map(row).join("")).join("")}
    </div></div>
    <div class="hv-legend">${key}<span class="hv-key"><i class="hv-dot-key hv-flag"></i>Something about the question or coding changes here</span></div>
  </section>`;
}

// Marks the selected row and wave without redrawing the chart.
function hvMarkChart() {
  const root = $("#hvTimelines");
  if (!root) return;
  root.querySelectorAll(".hv-tl-row[data-timeline]").forEach(r => r.classList.toggle("on", r.dataset.timeline === HV.t));
  root.querySelectorAll(".hv-dot").forEach(d => {
    const mine = d.closest(".hv-tl-row").dataset.timeline === HV.t && d.dataset.wave === HV.wave;
    d.classList.toggle("cur", mine);
    d.setAttribute("aria-pressed", String(mine));
  });
}

function hvTimelineCard() {
  const t = HV.tl;
  const waves = hvTlWaves(), i = waves.findIndex(w => w.wave_key === HV.wave);
  const programs = HV.programs.filter(p => waves.some(w => w.program === p));
  const inst = hvList(t.instruments);
  const rel = inst.length > 1 ? hvList(HV.d.relations).find(r => inst.includes(r.instrument_a) && inst.includes(r.instrument_b)) : null;
  const seq = hvLevelSeq(t);
  const joined = hvIsJoined(t);
  const changing = hvList(t.all_waves).length > 0;
  const levelText = joined
    ? `${hvRegionsText(t.n_units)}. Regions that changed between waves are joined, and the rest stay at their lowest level, so the same area is compared in all ${t.n_waves} waves.`
    : t.level
    ? `${hvRegionsText(t.n_units)} at ${t.level_label}. Reaches ${t.n_waves} of ${HV.d.waves.length} waves in ${hvCountryName(HV.iso)}.${changing ? " Some regions change along the way, so they are not the same area in every wave. With all waves selected, the map joins them." : ""}`
    : `The finest coding each wave has, so the regions change from ${seq.join(" to ")} along the way. With all waves selected, the map shows regions that stay the same.`;
  let lastYear = null;
  const ticks = waves.map((w, n) => {
    const y = hvYear(w), label = y !== lastYear ? y : "";
    lastYear = y;
    return `<span class="hv-tick" style="left:${waves.length > 1 ? (100 * n / (waves.length - 1)).toFixed(3) : 0}%">${esc(label)}</span>`;
  }).join("");
  return `<section class="card hv-time${i < 0 ? " idle" : ""}" id="hvTime">
    <div class="hv-tl-now"><h3>${esc(programs.join(" and "))}: ${esc(hvTlTitle(t))}${t.level ? ` (${esc(t.level_label)})` : ""}, ${esc(hvTlYears(t))}</h3>
      <dl class="hv-meta">
        <dt>Questions</dt><dd>${rel ? esc(rel.rationale) + (rel.status === "proposed" ? ". This join is proposed, not yet confirmed." : "") : "One instrument: the same item in every wave of this program."}</dd>
        <dt>Geography</dt><dd>${esc(levelText)}</dd>
        <dt>Available as</dt><dd>${hvList(t.forms).map(f => esc(HV_FORMS[f] || f)).join("; ")}</dd>
      </dl></div>
    <div class="hv-time-row">
      <button type="button" class="btn small" id="hvAllWaves" aria-pressed="${i < 0}">All waves</button>
      <div class="hv-slide">
        <div class="hv-now" id="hvNow" aria-live="polite">${esc(hvNowText())}</div>
        <input type="range" id="hvSlider" min="0" max="${waves.length - 1}" step="1" value="${Math.max(0, i)}" aria-label="Wave" aria-valuetext="${esc(hvNowText())}">
        <div class="hv-ticks" aria-hidden="true">${ticks}</div>
      </div>
    </div>
  </section>`;
}

function hvNowText() {
  if (hvIsAll()) {
    const w = hvTlWaves();
    return `All ${w.length} waves in this timeline, ${hvYear(w[0])}–${hvYear(w[w.length - 1])}. Move the slider to see one wave.`;
  }
  const w = hvWave(HV.wave);
  return `${hvWaveLabel(w)}, ${hvMonth(w)}`;
}

/* ---------- country view ---------- */
function hvCountryBody() {
  const totals = hvTotals(hvCellsInView());
  if (HV.unit && !totals.has(HV.unit)) HV.unit = null;
  const panel = HV.src ? hvSourcePanel() : HV.unit ? hvRegionPanel(totals) : !hvIsAll() ? hvWavePanel() : hvIntroPanel(totals);
  return `<div class="hv-main">
      ${hvMap(totals)}
      <aside class="card hv-panel" aria-live="polite">${panel}</aside>
    </div>
    ${hvChangesCard()}
    ${hvQuestions()}
    ${hvNotCoded()}
    ${hvRegionTable(totals)}`;
}

function hvRedrawBody(refocus) {
  const body = $("#hvBody");
  if (!body) return hvDraw(refocus);
  body.innerHTML = hvCountryBody();
  hvMarkChart();
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
  const onMap = regions.reduce((a, r) => a + r.n, 0);
  // Regions no source gives a boundary for stay off the map and in the table below.
  const noShape = [...totals.keys()].filter(id => !shapes.paths[id]);
  const noShapeN = noShape.reduce((a, id) => a + totals.get(id), 0);
  const off = hvCellsInView().filter(c => !c.unit).reduce((a, c) => a + c.n, 0);
  const w = hvIsAll() ? null : hvWave(HV.wave);
  const title = w ? `${hvWaveLabel(w)}, ${hvYear(w)}: ${hvRegionsText(totals.size)}` : `All waves in this timeline: ${hvRegionsText(totals.size)}`;
  return `<figure class="card hv-map">
    <figcaption><b>${esc(title)}</b><br><span class="muted">${fmt(onMap)} respondents on the map${noShape.length ? ` · ${fmt(noShapeN)} in ${noShape.length} ${noShape.length === 1 ? "region" : "regions"} with no boundary to draw (listed below)` : ""}${off ? ` · ${fmt(off)} could not be coded (listed below)` : ""}</span></figcaption>
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
  const parts = hvList(HV.shapes.credits).map(c => /^Eurostat/.test(c.source)
    ? `<a href="${esc(c.license_url)}" rel="noopener">${esc(c.source)}</a>. ${esc(c.license)}.`
    : `<a href="${esc(c.url)}" rel="noopener">geoBoundaries</a> ${esc(c.boundary_id)}, ${esc(c.source)} (${esc(c.year)}). ${esc(c.license)}.`);
  return `<p class="hv-credit muted">Boundaries: ${[...new Set(parts)].join(" ")} ${esc(HV.index.note || "")}</p>`;
}

/* ---------- how the regions changed ---------- */
const HV_X_HUES = 7; // the eighth hue marks a region split by the change
const hvXWaves = list => {
  const w = hvList(list).map(k => String(k).replace(":", " "));
  return !w.length ? "No wave" : w.length === 1 ? w[0] : `${w[0]} to ${w[w.length - 1]}`;
};
const hvXShort = name => String(name).replace(/\s*\(.*$/, "");
function hvXMap(title, sub, box, items, lines, labels) {
  const { paths, outline } = HV.shapes;
  const fills = items.filter(i => paths[i.id]).map(i => `<path class="hv-x ${i.cls}" d="${paths[i.id]}"><title>${esc(i.title || i.name)}</title></path>`).join("");
  const edge = lines.filter(id => paths[id]).map(id => `<path class="hv-xl" d="${paths[id]}"></path>`).join("");
  const w = +String(box).split(" ")[2], fs = (w / 20).toFixed(1);
  const shown = items.filter(i => paths[i.id] && labels[i.id]);
  const text = shown.length <= 14 ? shown.map(i => {
    const [x, y] = labels[i.id];
    return `<text class="hv-xt" x="${x}" y="${y}" font-size="${fs}" style="stroke-width:${(fs / 4).toFixed(1)}">${esc(i.label || hvXShort(i.name))}</text>`;
  }).join("") : "";
  return `<figure class="hv-xmap"><figcaption><b>${esc(title)}</b><span class="muted">${esc(sub)}</span></figcaption>
    <svg viewBox="${esc(box)}" role="img" aria-label="${esc(title)}: ${esc(items.map(i => i.name).join(", "))}"><path class="hv-base" d="${outline}"></path>${fills}${edge}${text}</svg></figure>`;
}
function hvXBlock(g) {
  const before = hvList(g.before), after = hvList(g.after), groups = hvList(g.groups);
  const labels = g.labels || {};
  const nameOf = new Map([...before, ...after].map(u => [u.id, u.name]));
  // Colors follow the new regions; with too many of them, the areas a timeline keeps.
  const byGroup = after.length > HV_X_HUES;
  const groupIndex = new Map(groups.map((x, i) => [x.id, i]));
  const groupOf = new Map();
  for (const x of groups) for (const u of [...hvList(x.after), ...hvList(x.before)]) groupOf.set(u, x.id);
  const hue = i => `hv-x${(i % HV_X_HUES) + 1}`;
  const afterHue = id => byGroup ? hue(groupIndex.get(groupOf.get(id)) || 0) : hue(after.findIndex(u => u.id === id));
  const beforeItems = before.map(u => {
    const moves = hvList(u.moves);
    const whole = moves.length && moves[0].share >= 0.85;
    const cls = byGroup ? hue(groupIndex.get(groupOf.get(u.id)) || 0) : whole ? afterHue(moves[0].to) : "hv-x8";
    return { id: u.id, name: u.name, cls, title: u.name + (moves.length ? ": " + moves.map(m => `${Math.round(m.share * 100)}% in ${nameOf.get(m.to) || m.to}`).join(", ") : "") };
  });
  const afterItems = after.map(u => ({ id: u.id, name: u.name, cls: afterHue(u.id) }));
  let hueAt = 0;
  const groupItems = groups.map(x => {
    const n = hvList(x.after).length + hvList(x.before).length;
    return { id: x.id, name: x.name, cls: x.joined ? hue(hueAt++) : "hv-xn", label: x.joined && x.name.length > 26 ? `${hvList(x.after).length} regions joined` : hvXShort(x.name), n };
  });
  const box = g.box;
  const split = before.filter(u => hvList(u.moves).length > 1);
  const open = hvList(g.events).some(e => e.status === "needs_decision");
  const year = String(g.date).slice(0, 4);
  const maps = !box ? `<p class="muted">No boundary to draw for these regions.</p>` : `<div class="hv-xmaps">
      ${hvXMap(`Before: ${hvRegionsText(before.length)}`, hvXWaves(g.waves_before), box, beforeItems, [], labels)}
      ${hvXMap(`After: ${hvRegionsText(after.length)}`, hvXWaves(g.waves_after), box, afterItems, [], labels)}
      ${hvXMap("What moved", "The new regions, with the old lines drawn over them.", box, afterItems.map(i => ({ ...i, label: " " })), before.map(u => u.id), {})}
      ${hvXMap(`Across the change: ${groups.length} ${groups.length === 1 ? "area" : "areas"}`, "What a timeline across this change keeps here. Colored areas are joined regions. The rest of the country stays as it is.", box, groupItems, [], labels)}
    </div>`;
  // A timeline crosses the change if it holds waves from both sides of it. Joined timelines come first, and
  // of those with the same number of regions, only the longest.
  const across = hvTimelines().filter(t => t.level && hvList(g.waves_before).some(k => hvList(t.waves).includes(k)) && hvList(g.waves_after).some(k => hvList(t.waves).includes(k)));
  const joinedAcross = across.filter(hvIsJoined);
  const crossing = (joinedAcross.length ? joinedAcross : across).slice().sort((a, b) => b.n_waves - a.n_waves)
    .filter((t, i, list) => list.findIndex(x => x.n_units === t.n_units) === i);
  return `<details class="hv-xblock" open><summary><b>${esc(year)}: ${esc(hvRegionsText(before.length))} become ${after.length}</b>${open ? ` <span class="hv-xopen">Open: needs your decision</span>` : ""}</summary>
    ${maps}
    ${!byGroup && split.length ? `<p class="hv-xland"><b>By land:</b> ${split.map(u => `${esc(hvXShort(u.name))}: ${hvList(u.moves).map(m => `${Math.round(m.share * 100)}% in ${esc(hvXShort(nameOf.get(m.to) || m.to))}`).join(", ")}`).join("; ")}. From the boundary files, so land and not people.</p>` : ""}
    <p class="hv-xland">${crossing.length ? `${crossing.length === 1 ? "Timeline" : "Timelines"} across this change: ${crossing.map(t => `<a href="${hvHref({ c: HV.iso, t: t.id })}">${esc(hvRegionsText(t.n_units))}, ${esc(hvTlYears(t))}</a>`).join("; ")}.` : "No timeline crosses this change, because the waves on its two sides lie too far apart."}</p>
    <ul class="hv-xnotes">${hvList(g.events).map(e => `<li>${esc(e.notes)}</li>`).join("")}</ul>
  </details>`;
}
function hvChangesCard() {
  const list = hvList(HV.shapes.changes);
  if (!list.length) return "";
  return `<section class="card hv-changes"><h3>How the regions changed in ${esc(hvCountryName(HV.iso))}</h3>
    <p class="muted">Changes that move people between regions. Gray means the same region before and after. Hover over a region for its name.</p>
    ${list.map(hvXBlock).join("")}</section>`;
}

function hvIntroPanel(totals) {
  return `<h3>Click a wave or a region</h3>
    <p>Click a wave on a timeline, or move the slider, to see its question and which answers were coded to what.</p>
    <p>Click a region to see the source data that make it up, then a source to see how its region codes were coded.</p>
    <p class="muted">${hvRegionsText(totals.size)} in this timeline.</p>`;
}

/* The depth of the coding in one wave: the question as asked, what each answer was coded to, how regions were coded. */
function hvWavePanel() {
  const w = hvWave(HV.wave);
  const changes = hvChangeTexts(hvFlagKinds(hvChangesAt(HV.tl, w.wave_key)));
  const answers = hvList(HV.d.answers).filter(a => a.wave === w.wave_key);
  const sources = [...new Set(hvCellsInView().map(c => c.source))];
  const leftOut = x => x == null ? `<span class="muted">left out</span>` : esc(x);
  const row = (dt, dd) => dd ? `<dt>${esc(dt)}</dt><dd>${esc(dd)}</dd>` : "";
  return `<div class="hv-panel-head"><h3>${esc(hvWaveLabel(w))}, ${esc(hvMonth(w))}</h3><button type="button" class="btn small" id="hvCloseWave">All waves</button></div>
    ${changes.length ? `<div class="hv-note"><b>Changes at this wave</b><ul>${changes.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}
    <h4>The question</h4>
    <dl class="hv-meta">
      <dt>Question</dt><dd>${esc(w.question_id)}, item ${esc(w.item_no)}, page ${esc(w.page)} of the ${w.questionnaire_url ? `<a href="${esc(w.questionnaire_url)}" rel="noopener">questionnaire</a>` : "questionnaire"} (study ${esc(w.study)})</dd>
      ${row("Wording", w.wording)}
      ${row("Answers offered", w.scale)}
      ${row("How it is asked", w.presentation)}
      ${row("Don't know", w.dk_presentation)}
      ${row("Interview mode", w.mode)}
      ${row("Definitions given", w.definition)}
      ${row("Note", w.notes)}
      <dt>In the file</dt><dd>${esc(w.file)}: <code>${esc(w.variable)}</code>${w.variable_label ? `, ${esc(w.variable_label)}` : ""}</dd>
      <dt>Fieldwork</dt><dd>${esc(w.date_min)} to ${esc(w.date_max)}, from the ${esc(w.date_basis)}</dd>
    </dl>
    <h4>What the answers were coded to</h4>
    ${answers.some(a => a.status === "proposed") ? `<p class="muted">This coding is proposed, not yet confirmed.</p>` : ""}
    <div class="hv-scroll"><table class="occ"><thead><tr><th>Code</th><th>Label in the file</th><th class="num">Respondents</th><th>Coded as</th><th class="num">1 or 0</th><th class="num">Original scale</th><th>Why</th></tr></thead>
      <tbody>${answers.map(a => `<tr><td>${esc(a.code)}</td><td>${hvLabel(a.label)}</td><td class="num">${fmt(a.n)}</td><td>${esc(HV_CODED[a.coded] || a.coded)}</td><td class="num">${leftOut(a.bin)}</td><td class="num">${leftOut(a.orig)}</td><td class="hv-why">${esc(a.why || "")}</td></tr>`).join("")}</tbody></table></div>
    <h4>How its regions were coded</h4>
    <p class="muted">${w.fine_units} regions coded${w.coded_level ? ` at ${esc(w.coded_level)}` : ""}${HV.tl.level && HV.tl.level_label !== w.coded_level ? `, counted at ${esc(HV.tl.level_label)} in this timeline` : ""}. Click a source for every code.</p>
    <div class="hv-srcs">${sources.map(s => `<button type="button" class="btn small" data-src="${esc(s)}">${esc(hvSourceLabel(s))}</button>`).join("")}</div>`;
}

function hvRegionPanel(totals) {
  const cells = hvCellsInView().filter(c => c.unit && hvRegion(c.unit) === HV.unit);
  const waves = new Set(cells.map(c => c.wave));
  const parts = [...new Set(cells.map(c => c.unit))].filter(u => u !== HV.unit);
  const order = new Map(HV.d.waves.map((w, i) => [w.wave_key, i]));
  const rows = cells.slice().sort((a, b) => order.get(a.wave) - order.get(b.wave) || a.source.localeCompare(b.source) || String(a.code).localeCompare(String(b.code)));
  return `<div class="hv-panel-head"><h3>${esc(hvName(HV.unit))}</h3><button type="button" class="btn small" data-clear>Close</button></div>
    <p><b>${fmt(totals.get(HV.unit))}</b> respondents in ${waves.size} ${waves.size === 1 ? "wave" : "waves"}.${parts.length ? ` <span class="muted">Coded as ${esc(parts.map(hvName).join(", "))}${cells.some(c => c.unit === HV.unit) ? " in some waves" : ""}.</span>` : ""}</p>
    <p class="muted">Click a source to see how its regions were coded.</p>
    <div class="hv-scroll"><table class="occ"><thead><tr><th>Year</th><th>Source</th><th>Region variable</th><th>Code</th><th>Label in the file</th>${parts.length ? "<th>Coded as</th>" : ""}<th class="num">Respondents</th></tr></thead>
    <tbody>${rows.map(c => `<tr class="row" data-src="${esc(c.source)}" tabindex="0"><td>${esc(hvYear(hvWave(c.wave)))}</td><td>${esc(hvSourceLabel(c.source))}</td>
      <td>${esc(c.var)}</td><td>${esc(c.code)}</td><td>${hvLabel(c.label)}</td>${parts.length ? `<td>${esc(hvName(c.unit))}</td>` : ""}<td class="num">${fmt(c.n)}</td></tr>`).join("")}</tbody></table></div>`;
}

function hvSourcePanel() {
  const rows = HV.d.coding.filter(c => c.source === HV.src);
  const fallback = () => { HV.src = null; return HV.unit ? hvRegionPanel(hvTotals(hvCellsInView())) : !hvIsAll() ? hvWavePanel() : hvIntroPanel(hvTotals(hvCellsInView())); };
  if (!rows.length) return fallback();
  const w = hvSourceWave(HV.src);
  const vars = [...new Set(rows.map(r => r.var))];
  const used = vars.filter(x => rows.find(r => r.var === x).used);
  const other = vars.filter(x => !used.includes(x));
  const block = name => {
    const list = rows.filter(r => r.var === name);
    const counted = HV.tl.level && list.some(r => r.unit && hvRegion(r.unit) && hvRegion(r.unit) !== r.unit);
    return `<div class="hv-scroll"><table class="occ"><thead><tr><th>Code</th><th>Label in the file</th><th class="num">Respondents</th><th>Coded as</th>${counted ? "<th>In this timeline</th>" : ""}<th>Why</th></tr></thead>
      <tbody>${list.map(r => {
        const mine = HV.unit && r.unit && hvRegion(r.unit) === HV.unit;
        const coded = r.unit ? esc(r.unit_name || r.unit) : `<span class="hv-tag">Not coded</span>`;
        const inTl = r.unit && hvRegion(r.unit) ? esc(hvName(hvRegion(r.unit))) : "–";
        return `<tr${mine ? ' class="on"' : ""}><td>${esc(r.code)}</td><td>${hvLabel(r.label)}</td><td class="num">${fmt(r.n)}</td><td>${coded}</td>${counted ? `<td>${inTl}</td>` : ""}<td class="hv-why">${esc(r.rationale)}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  };
  const head = name => {
    const r = rows.find(x => x.var === name);
    return `<code>${esc(name)}</code> ${esc(r.var_label || "")}`;
  };
  const backTo = HV.unit ? `Back to ${esc(hvName(HV.unit))}` : !hvIsAll() ? "Back to the wave" : "Close";
  return `<div class="hv-panel-head"><h3>How ${esc(hvSourceLabel(HV.src))}${w ? `, ${esc(hvYear(w))},` : ""} coded its regions</h3><button type="button" class="btn small" data-back>${backTo}</button></div>
    ${w ? `<p class="muted">${esc(w.file)}${w.study ? `, study ${esc(w.study)}` : ""}. Fieldwork ${esc(w.date_min)} to ${esc(w.date_max)}.</p>` : ""}
    ${used.map(n => `<h4>${head(n)} <span class="hv-tag used">Used for the map</span></h4>${block(n)}`).join("")}
    ${other.length ? `<details class="hv-more"><summary>${other.length} other region ${other.length === 1 ? "variable" : "variables"} in this source, not used for the map</summary>
      ${other.map(n => `<h4>${head(n)}</h4>${block(n)}`).join("")}</details>` : ""}`;
}

/* Every question in the selected harmonization, wave by wave, so differences between versions show. */
function hvQuestions() {
  const waves = hvTlWaves();
  const fields = ["wording", "scale", "presentation", "dk_presentation", "mode", "definition"];
  const heads = { wording: "Wording", scale: "Answers offered", presentation: "How it is asked", dk_presentation: "Don't know", mode: "Mode", definition: "Definitions given" };
  const versions = f => new Set(waves.map(w => w[f])).size;
  const summary = fields.filter(f => versions(f) > 1).map(f => `${heads[f].toLowerCase()} ${versions(f)}`).join(", ");
  const rows = waves.map((w, i) => {
    const prev = waves[i - 1];
    const cells = fields.map(f => `<td class="${prev && prev[f] !== w[f] ? "hv-diff" : ""}">${esc(w[f])}</td>`).join("");
    return `<tr class="row${w.wave_key === HV.wave ? " on" : ""}" data-qwave="${esc(w.wave_key)}" tabindex="0"><td>${esc(hvYear(w))}</td><td>${esc(hvWaveLabel(w))}</td><td>${esc(w.question_id)}.${esc(w.item_no)}, p. ${esc(w.page)}</td><td><code>${esc(w.variable)}</code></td>${cells}</tr>`;
  }).join("");
  return `<section class="card hv-qs"><h3>Every question in this timeline</h3>
    <p class="muted">${waves.length} waves. ${summary ? `Versions across them: ${esc(summary)}. ` : ""}Highlighted cells differ from the wave before. Click a wave for how its answers were coded.</p>
    <div class="hv-scroll"><table class="occ hv-qtable"><thead><tr><th>Year</th><th>Wave</th><th>Question</th><th>Variable</th>${fields.map(f => `<th>${esc(heads[f])}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function hvNotCoded() {
  const k = new Set(hvTlWaveKeys());
  const rows = hvList(HV.d.not_coded).filter(r => k.has(r.wave) && (hvIsAll() || r.wave === HV.wave));
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
    <tbody>${rows.map(r => `<tr class="row${r.id === HV.unit ? " on" : ""}" data-unit="${esc(r.id)}" tabindex="0"><td>${esc(r.name)}${HV.shapes.paths[r.id] ? "" : ` <span class="muted">(no boundary on the map)</span>`}</td><td class="num">${fmt(r.n)}</td></tr>`).join("")}</tbody></table></div></section>`;
}

/* ---------- events ---------- */
function hvSetWave(key) {
  HV.wave = key; HV.src = null; HV.unit = null;
  const t = $("#hvTime");
  if (t) t.classList.toggle("idle", hvIsAll());
  const all = $("#hvAllWaves");
  if (all) all.setAttribute("aria-pressed", String(hvIsAll()));
  const now = $("#hvNow");
  if (now) now.textContent = hvNowText();
  const sl = $("#hvSlider");
  if (sl) {
    sl.setAttribute("aria-valuetext", hvNowText());
    const i = hvTlWaves().findIndex(w => w.wave_key === key);
    if (i >= 0) sl.value = i;
  }
  hvRedrawBody();
}

function hvPick(id, wave) {
  const same = id === HV.t;
  if (!same) {
    HV.unit = null; HV.src = null;
    if (wave) HV.wave = wave;
    hvSelectTimeline(id);
    hvDraw();
    return;
  }
  if (wave) hvSetWave(wave);
}

function hvHoverRegion(region) {
  if (HV.hoverRegion === region) return;
  HV.hoverRegion = region;
  document.querySelectorAll("#harmonizedView path.hv-w.hover").forEach(p => p.classList.remove("hover"));
  if (region) document.querySelectorAll(`#harmonizedView path.hv-w[data-region="${CSS.escape(region)}"]`).forEach(p => p.classList.add("hover"));
}

function hvBind(root) {
  const act = target => {
    const dot = target.closest(".hv-dot");
    if (dot) { tipAt(null, null); hvPick(dot.closest(".hv-tl-row").dataset.timeline, dot.dataset.wave); return true; }
    const pick = target.closest("[data-timeline]");
    if (pick) { hvPick(pick.dataset.timeline, null); return true; }
    const qw = target.closest("[data-qwave]");
    if (qw) { hvSetWave(qw.dataset.qwave); return true; }
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
    if (e.target.closest("[data-hxview], [data-hxdo], #hxDownload")) { hxOnClick(e.target); return; }
    if (e.target.closest("#hvAllWaves, #hvCloseWave")) return hvSetWave("all");
    if (act(e.target)) return;
    if (e.target.closest("[data-back]")) { HV.src = null; return hvRedrawBody(); }
    if (e.target.closest("[data-clear]")) { HV.unit = null; HV.src = null; return hvRedrawBody(); }
  });
  root.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-unit], [data-src]:not(button), [data-country], [data-goregion], [data-qwave]")) { e.preventDefault(); act(e.target); }
  });
  root.addEventListener("input", e => {
    if (e.target.id === "hvSlider") hvSetWave(hvTlWaves()[+e.target.value].wave_key);
  });
  // Remembers which countries are folded on the export page: the toggle event does not bubble.
  root.addEventListener("toggle", e => {
    const b = e.target.dataset && e.target.dataset.hxblock;
    if (!b) return;
    (e.target.open ? HX.opened : HX.closed).add(b);
    (e.target.open ? HX.closed : HX.opened).delete(b);
  }, true);
  root.addEventListener("change", e => {
    if (hxOnChange(e.target)) return;
    if (["hvVar", "hvRegionPick", "hvCountryPick"].includes(e.target.id)) HV.refocus = `#${e.target.id}`;
    if (e.target.id === "hvVar") {
      HV.varId = e.target.value;
      // A new variable keeps you where you are, if it reaches there.
      const stay = HV.level === "country" && hvTotalsOfVar().some(t => t.iso3 === HV.iso) ? { c: HV.iso } : HV.region ? { r: HV.region } : {};
      location.hash = hvHref(stay).slice(1);
    }
    if (e.target.id === "hvRegionPick") location.hash = hvHref(e.target.value ? { r: e.target.value } : {}).slice(1);
    if (e.target.id === "hvCountryPick" && e.target.value) location.hash = hvHref({ c: e.target.value }).slice(1);
  });
  root.addEventListener("mousemove", e => {
    const d = e.target.closest(".hv-dot");
    if (d) {
      const w = hvWave(d.dataset.wave), t = hvTimelines().find(x => x.id === d.closest(".hv-tl-row").dataset.timeline);
      const changes = hvChangeTexts(hvFlagKinds(hvChangesAt(t, w.wave_key)));
      return tipAt(e, `<b>${esc(hvWaveLabel(w))}, ${esc(hvMonth(w))}</b>${fmt(w.n)} respondents, ${esc(w.fine_units)} regions coded${changes.length ? `<br>${changes.map(esc).join("<br>")}` : ""}`);
    }
    const c = e.target.closest("[data-codedwave]");
    if (c) {
      const w = hvWave(c.dataset.codedwave);
      return tipAt(e, `<b>${esc(hvWaveLabel(w))}, ${esc(hvYear(w))}</b>${esc(w.fine_units)} regions${w.coded_level ? ` at ${esc(w.coded_level)}` : ""}`);
    }
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
