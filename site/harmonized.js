"use strict";
/* Harmonized variables tab: the harmonized time series and how they were coded.
   What is selected leads everything on screen: all questions, one construct, or one question. The world map shows
   where it exists, country by country (Robinson projection); a click opens the world region, and there a country.
   A country page leads with its timelines on one axis, 1980 to 2025: every observation of the question, and every
   harmonized series through them, by which questions it joins and by geographic level. Maps show respondents or
   simple averages. The Timelines tab (harmonized_timelines.js) lists every timeline. Click a wave for its question and
   how the answers were coded; click a region for the source data behind it, and a source for how its codes were coded.
   Anything with no data is grey; darker blue means more respondents. Region codes that could not be coded stay off
   the map and are listed with their label from the file.
   Data: data/harmonized/ (aggregates from the survey harmonization project; rows/ holds each respondent's file, row, coded answer and region, and nothing else). */

const HV = {
  index: null, world: null, files: new Map(), bound: false, hoverRegion: null,
  sel: "all", varId: null, measure: "n", level: "world", region: null, iso: null, t: null, wave: "all", unit: null, src: null,   // what is on screen (kept in the URL)
  d: null, shapes: null, tl: null, names: new Map(), group: new Map(), drawAs: new Map(), levelMaps: new Map(), programs: [], scale: { all: {}, wave: {} },
};
const HV_WORLD_VIEW = { lon_min: -180, lat_min: -58, lon_max: 180, lat_max: 84 };
// Every timeline is drawn on the same axis (Torkel, 2026-11-24).
const HV_Y0 = 1980, HV_Y1 = 2025;
const HV_CODED = { pro: "Protectionist", anti: "Not protectionist", mid: "Middle category", no_side: "No protectionist side", dk: "Don't know", refused: "Refused", nonresp: "Nonresponse", not_asked: "Not asked", other_missing: "Other missing" };
/* What kind of question it is (Torkel, 2026-11-16). Most are judgements; strength and categorical questions have no
   protectionist side, so they are kept on their original scale only. A note says what else to keep in mind ("not own view"). */
const HV_QTYPE = {
  judgement: { label: "Judgement", text: "The respondent's own view, with a protectionist side: coded 1 or 0, and kept on its original scale." },
  strength: { label: "Strength", text: "How strongly the respondent holds the view given in the question before. It has no protectionist side of its own, so it is kept on its original scale only." },
  categorical: { label: "Categorical", text: "The answers have no protectionist side (a choice from a list, how much, a forecast, behavior, or someone else's view), so they are kept on their original scale only." },
};
const hvQType = x => HV_QTYPE[x && x.question_type] || HV_QTYPE.judgement;
// A note that only repeats what the type already says (a strength follow-up's "how strongly") is left out.
const hvTypeNote = x => x && x.type_note && !(x.question_type === "strength" && /^How strongly; the direction is in the question before$/.test(x.type_note)) ? x.type_note : "";
const hvQTypeTag = x => x && x.question_type && x.question_type !== "judgement" ? ` <span class="hv-tag hv-qtype">${esc(hvQType(x).label)}</span>` : "";
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
// The questions behind a wave's counts: one, unless its sources were asked through different variables (Cyprus's two communities).
const hvWaveVars = key => HV.d.waves.filter(w => w.wave_key === key);
const hvWaveCount = waves => new Set(waves.map(w => w.wave_key)).size;
// Variables the concept does not use in a wave, each with a note on why and on the one used instead.
const hvNotUsed = key => hvList(HV.d.not_used).filter(x => x.note && (key == null || x.wave === key));
const hvWaveLabel = w => `${w.program} ${w.wave}`;
const hvYear = w => String(w.date).slice(0, 4);
const hvMonth = w => new Date(w.date + "T00:00:00Z").toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" });
// Some region variables hold codes with no label: the code itself is what the file has.
const hvLabel = x => x ? esc(x) : `<span class="muted">no label in the file</span>`;
const hvTlWaveKeys = () => hvList(HV.tl.waves);
// One entry per wave, for the slider; hvTlQuestions has every question in them.
const hvTlQuestions = () => { const k = new Set(hvTlWaveKeys()); return HV.d.waves.filter(w => k.has(w.wave_key)); };
const hvTlWaves = () => { const seen = new Set(); return hvTlQuestions().filter(w => !seen.has(w.wave_key) && seen.add(w.wave_key)); };
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
const hvVars = () => hvList(HV.index.variables);
const hvVar = () => hvVars().find(x => x.id === HV.varId);
const hvConstructs = () => hvList(HV.index.constructs);
// What is selected: "all", "c:<construct>" or one question.
const hvSelConstruct = () => HV.sel.startsWith("c:") ? hvConstructs().find(c => c.id === HV.sel.slice(2)) : null;
const hvSelVars = () => HV.varId ? [hvVar()] : HV.sel === "all" ? hvVars() : hvVars().filter(v => v.construct === HV.sel.slice(2));
const hvSelName = () => HV.varId ? hvVar().name : hvSelConstruct() ? hvSelConstruct().name : "All questions";
function hvSelTotals() {
  const ids = new Set(hvSelVars().map(v => v.id));
  return hvList(HV.index.country_totals).filter(t => ids.has(t.variable));
}
const hvTotalsOfVar = () => hvList(HV.index.country_totals).filter(t => t.variable === HV.varId);
// Averages: the share coded 1 (protectionist) among answers coded 1 or 0. A question with no protectionist side has none.
const hvHasAverage = () => !!HV.varId && (hvVar().question_type || "judgement") === "judgement";
const hvAverage = () => HV.measure === "avg" && hvHasAverage();
const hvShare = (pro, bin) => bin > 0 ? 100 * pro / bin : null;
const hvPct = x => x == null ? "–" : `${x.toFixed(x < 10 && x > 0 ? 1 : 0)}%`;
// Every question with data in one country, and the countries with data for any question.
const hvTotalsOfCountry = iso => hvList(HV.index.country_totals).filter(t => t.iso3 === iso);
const hvCountriesWithAny = () => new Set(hvList(HV.index.country_totals).map(t => t.iso3));
// What the world and region maps show: every country with data for any question, with how many questions and
// the years they span. A region counts the different questions asked anywhere in it.
function hvCountrySummary() {
  if (HV.summary && HV.summary.index === HV.index && HV.summary.sel === HV.sel) return HV.summary.byIso;
  const byIso = new Map();
  for (const t of hvSelTotals()) {
    const s = byIso.get(t.iso3) || { iso3: t.iso3, vars: new Set(), first: Infinity, last: -Infinity, waves: 0, n: 0, bin: 0, pro: 0 };
    s.vars.add(t.variable); s.first = Math.min(s.first, +t.first_year); s.last = Math.max(s.last, +t.last_year);
    s.waves += +t.waves; s.n += +t.n; s.bin += +(t.bin || 0); s.pro += +(t.pro || 0);
    byIso.set(t.iso3, s);
  }
  for (const s of byIso.values()) { s.q = s.vars.size; s.avg = hvShare(s.pro, s.bin); }
  HV.summary = { index: HV.index, sel: HV.sel, byIso };
  return byIso;
}
function hvRegionSummary(byIso) {
  const out = new Map(hvList(HV.world.regions).map(r => [r.region, { vars: new Set(), countries: 0, n: 0, waves: 0, bin: 0, pro: 0 }]));
  for (const s of byIso.values()) {
    const r = out.get(hvCountryRegion(s.iso3));
    if (!r) continue;
    r.countries++; r.n += s.n; r.waves += s.waves; r.bin += s.bin; r.pro += s.pro;
    for (const v of s.vars) r.vars.add(v);
  }
  for (const r of out.values()) { r.q = r.vars.size; r.avg = hvShare(r.pro, r.bin); }
  return out;
}
const hvQuestionsText = n => `${n} ${+n === 1 ? "question" : "questions"}`;
const hvYearsText = s => s.first === s.last ? `${s.first}` : `${s.first}–${s.last}`;
const hvCountryName = iso => (HV.index.countries || {})[iso] || (HV.world.countries.find(c => c.iso3 === iso) || {}).name || iso;
const hvCountryRegion = iso => (HV.world.countries.find(c => c.iso3 === iso) || {}).region;
const hvHref = (extra = {}, sel = HV.sel) => "#" + new URLSearchParams({ v: "harmonized", var: sel, ...(HV.measure === "avg" ? { m: "avg" } : {}), ...extra }).toString();
const hvWavesText = n => `${n} ${+n === 1 ? "wave" : "waves"}`;
// The site's name for a geographic level.
const hvLevelLabel = x => x === "COMPOSITE" ? "Groups of regions" : x;
// Whether a wave's question has an item number (Q.32 item 1); a question asked on its own has none (Q.34).
const hvHas = v => v != null && String(v).trim() !== "";
const hvHasItem = w => hvHas(w.item_no);

/* ---------- the Robinson projection ---------- */
// The projection's table, every five degrees of latitude (Robinson 1974), read linearly in between.
const HV_ROB = [[1, 0], [.9986, .062], [.9954, .124], [.99, .186], [.9822, .248], [.973, .31], [.96, .372], [.9427, .434], [.9216, .4958], [.8962, .5571],
  [.8679, .6176], [.835, .6769], [.7986, .7346], [.7597, .7903], [.7186, .8435], [.6732, .8936], [.6213, .9394], [.5722, .9761], [.5322, 1]];
// Longitude and latitude to map units (1,000 = the projection's radius). `dlon` is degrees from the map's middle meridian.
function hvRobinson(dlon, lat) {
  const a = Math.min(90, Math.abs(lat)) / 5, i = Math.min(17, Math.floor(a)), f = a - i;
  const X = HV_ROB[i][0] + f * (HV_ROB[i + 1][0] - HV_ROB[i][0]), Y = HV_ROB[i][1] + f * (HV_ROB[i + 1][1] - HV_ROB[i][1]);
  return [848.7 * X * dlon * Math.PI / 180, -1352.3 * Y * Math.sign(lat)];
}
// The countries' shapes come as longitude and latitude in hundredths of a degree (M x y, then relative steps).
function hvRings(path) {
  if (!HV.rings) HV.rings = new Map();
  if (HV.rings.has(path)) return HV.rings.get(path);
  const rings = path.split(/(?=M)/).filter(Boolean).map(part => {
    const [head, ...rest] = part.replace(/^M/, "").replace(/z/gi, "").split("l");
    let [x, y] = head.trim().split(/[ ,]+|(?<=\d)(?=-)/).map(Number);
    const pts = [[x / 100, -y / 100]];
    const d = (rest.join(" ").match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    for (let k = 0; k + 1 < d.length; k += 2) { x += d[k]; y += d[k + 1]; pts.push([x / 100, -y / 100]); }
    return pts;
  });
  HV.rings.set(path, rings);
  return rings;
}
// A country's path around one middle meridian. A ring is moved as a whole when it lies across the map's edge.
function hvWorldPath(country, lon0) {
  if (!HV.projected) HV.projected = new Map();
  const key = `${country.iso3}|${lon0}`;
  if (HV.projected.has(key)) return HV.projected.get(key);
  const d = hvRings(country.path).map(pts => {
    const mean = pts.reduce((a, p) => a + p[0], 0) / pts.length - lon0;
    const shift = lon0 === 0 ? 0 : mean > 180 ? -360 : mean < -180 ? 360 : 0;
    return "M" + pts.map(p => { const [x, y] = hvRobinson(p[0] - lon0 + shift, p[1]); return `${x.toFixed(1)} ${y.toFixed(1)}`; }).join("L") + "z";
  }).join("");
  HV.projected.set(key, d);
  return d;
}
// The frame a window of longitude and latitude fills on the map.
function hvFrame(view, lon0) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i <= 24; i++) for (let j = 0; j <= 24; j++) {
    const [x, y] = hvRobinson(+view.lon_min + i * (+view.lon_max - +view.lon_min) / 24 - lon0, +view.lat_min + j * (+view.lat_max - +view.lat_min) / 24);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1 - x0, y1 - y0].map(v => v.toFixed(1)).join(" ");
}
// The edge of the world, and a light grid every 30 degrees.
function hvGlobe() {
  if (HV.globe) return HV.globe;
  const line = pts => "M" + pts.map(([a, b]) => hvRobinson(a, b).map(v => v.toFixed(1)).join(" ")).join("L");
  const lats = []; for (let b = -90; b <= 90; b += 3) lats.push(b);
  const edge = line([...lats.map(b => [-180, b]), ...lats.slice().reverse().map(b => [180, b])]) + "z";
  const grid = []; for (let a = -150; a <= 150; a += 30) grid.push(line(lats.map(b => [a, b])));
  for (let b = -60; b <= 60; b += 30) grid.push(line([[-180, b], [180, b]]));
  return HV.globe = `<path class="hv-sea" d="${edge}"></path><path class="hv-grat" d="${grid.join("")}"></path>`;
}

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
// Shares in percent, in equal steps of 5 to 25 points, with a color of their own. Few steps stay close in color, so a small
// difference doesn't look like a large one.
function hvShareScale(values) {
  const v = values.filter(x => x != null).map(Math.round);
  if (!v.length) return { share: true, step: 20, first: 0, count: 0 };
  const lo = Math.min(...v), hi = Math.min(99, Math.max(...v));
  const step = [5, 10, 15, 20].find(w => Math.floor(hi / w) - Math.floor(lo / w) < 5) || 25;
  return { share: true, step, first: Math.floor(Math.min(99, lo) / step), count: Math.floor(hi / step) - Math.floor(Math.min(99, lo) / step) + 1 };
}
const HV_SHARE_COLORS = { 1: [3], 2: [2, 4], 3: [2, 3, 4], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5] };
const hvShareColor = (i, count) => (HV_SHARE_COLORS[count] || HV_SHARE_COLORS[5])[Math.max(0, Math.min(i, count - 1))];
const hvShareClass = (x, sc) => x == null ? "hv-no" : `hv-a${hvShareColor(Math.floor(Math.min(99, Math.round(x)) / sc.step) - sc.first, sc.count)}`;

function hvTotals(cells) {
  const m = new Map();
  for (const c of cells) if (c.unit) { const r = hvRegion(c.unit); if (r) m.set(r, (m.get(r) || 0) + c.n); }
  return m;
}

// The averages in view, per region: answers coded 1 or 0, and how many of them 1.
function hvAverages(values) {
  const m = new Map();
  for (const v of values) {
    const r = v.unit ? hvRegion(v.unit) : null;
    if (!r) continue;
    const a = m.get(r) || { bin: 0, pro: 0 };
    a.bin += v.bin; a.pro += v.pro;
    m.set(r, a);
  }
  return m;
}
const hvValuesInView = () => { const k = new Set(hvTlWaveKeys()); return hvList(HV.d.values).filter(v => k.has(v.wave) && (hvIsAll() || v.wave === HV.wave)); };
// The whole country in one wave, or in every wave in view, with respondents who have no region.
function hvCountryAverage(wave) {
  const k = new Set(hvTlWaveKeys());
  const list = hvList(HV.d.values).filter(v => wave ? v.wave === wave : k.has(v.wave));
  return { bin: list.reduce((a, v) => a + v.bin, 0), pro: list.reduce((a, v) => a + v.pro, 0) };
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
// Every observation of the question in the country, on one timeline, however far apart the waves lie. It harmonizes
// nothing beyond the coding of each wave.
function hvAllTimeline(d = HV.d) {
  const waves = d.waves.filter((w, i, all) => all.findIndex(x => x.wave_key === w.wave_key) === i);
  const dates = waves.map(w => String(w.date)).sort();
  return { id: "all", all: true, scheme: "fine", waves: waves.map(w => w.wave_key), level: null, level_label: null, n_units: new Set(hvList(d.cells).filter(c => c.unit).map(c => c.unit)).size,
    n_waves: waves.length, start: dates[0], end: dates[dates.length - 1], changes: [], instruments: [...new Set(d.waves.map(w => w.instrument))], forms: [], all_waves: [] };
}
// A country page opens on every observation. Where that leaves the all-waves map one region (the levels differ too much
// between waves) and a timeline at a fixed level has more, it opens on that one: the most waves, then the most detailed.
function hvPickTimeline(id) {
  const all = hvTimelines();
  if (id === "all") return hvAllTimeline();
  const found = all.find(t => t.id === id);
  if (found) return found;
  const whole = hvAllTimeline();
  const groups = new Set(hvList(HV.d.cells).filter(c => c.unit).map(c => HV.group.get(c.unit) || c.unit));
  const fixed = all.filter(t => t.level && t.n_units > 1).sort((a, b) => b.n_waves - a.n_waves || b.n_units - a.n_units)[0];
  return groups.size < 2 && fixed ? fixed : whole;
}
// Why a country has no harmonized timeline through its observations.
function hvNoTimelineText() {
  const placed = HV.d.cells.some(c => c.unit), n = hvAllTimeline().n_waves;
  return !placed ? "No harmonized timeline connects them: no respondent here could be tied to a region. They are kept, and the reasons are listed below."
    : n === 1 ? "There is one wave here, and a harmonized timeline needs two."
    : "No harmonized timeline connects these waves yet: they lie too far apart in time, or each wave asks its own version of the question and the versions are not linked.";
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
  if (HV.level === "timelines") { p.tab = "timelines"; if (HV.iso) p.c = HV.iso; }
  if (HV.level === "region") p.r = HV.region;
  if (HV.level === "overview") p.c = HV.iso;
  if (HV.level === "country") {
    p.c = HV.iso;
    if (HV.t) p.t = HV.t;
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
    const want = p.get("var") || "all";
    HV.varId = (hvVars().find(x => x.id === want) || {}).id || null;
    HV.sel = HV.varId || (want.startsWith("c:") && hvConstructs().some(c => `c:${c.id}` === want) ? want : "all");
    HV.measure = p.get("m") === "avg" ? "avg" : "n";
    const iso = p.get("c");
    HV.unit = HV.src = null;
    HV.wave = "all";
    HV.tl = null;
    if (p.get("x")) {
      HV.level = "export"; HV.iso = null; HV.region = null;
      await hxEnter(iso, p.get("t"), p.get("r"));
    } else if (p.get("tab") === "timelines") {
      HV.level = "timelines"; HV.region = null; HV.iso = iso && hvCountriesWithAny().has(iso) ? iso : null;
      HV.timelines = hvList(await hvFile("timelines"));
    } else if (iso && hvTotalsOfVar().some(t => t.iso3 === iso)) {
      HV.level = "country"; HV.iso = iso; HV.region = hvCountryRegion(iso);
      await hvLoadCountry();
      if (hvWave(p.get("w"))) HV.wave = p.get("w");
      hvSelectTimeline(p.get("t"));
      HV.unit = p.get("u") || null;
      HV.src = p.get("src") || null;
    } else if (iso && hvCountriesWithAny().has(iso)) {
      // A country with all questions or one construct selected, or where the selected question was not asked: its questions.
      HV.level = "overview"; HV.iso = iso; HV.region = hvCountryRegion(iso);
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
function hvTabs() {
  const here = HV.level === "export" ? "export" : HV.level === "timelines" ? "timelines" : "map";
  const country = HV.level === "country" || HV.level === "overview" || HV.level === "timelines" ? HV.iso : null;
  const tabs = [["map", "Map", hvHref(country ? { c: country } : HV.region ? { r: HV.region } : {})],
    ["timelines", "Timelines", hvHref({ tab: "timelines", ...(country ? { c: country } : {}) })],
    ["export", "Export data", hvHref({ x: 1, ...(HV.level === "country" ? { c: HV.iso, t: HV.t } : HV.region ? { r: HV.region } : {}) })]];
  return `<nav class="tabs hv-tabs" aria-label="Harmonized variables">${tabs.map(([id, label, href]) => `<a href="${href}"${id === here ? ` class="on" aria-current="page"` : ""}>${label}</a>`).join("")}</nav>`;
}

function hvDraw(refocus) {
  const root = $("#harmonizedView");
  const head = `<div class="pi-head"><h2>Harmonized variables</h2>
      <p class="muted">The harmonized time series so far, and how they were coded. Choose a question or a construct: the map, the lists and the timelines follow it.</p></div>
    ${hvTabs()}`;
  if (HV.level === "export") {
    root.innerHTML = `<div class="hv-wrap">${head}
      <p class="muted hx-intro">Pick the variables, countries and timelines you want. You get the data, one item and answer mapping, and one region mapping per country.</p>
      <div id="hxBody">${hxBody()}</div>
    </div>`;
    hvSync();
    hxRefresh();
    return;
  }
  if (HV.level === "timelines") {
    root.innerHTML = `<div class="hv-wrap">${head}${hvControls()}<div id="htBody">${htBody()}</div></div>`;
    hvSync();
    if (refocus) { const el = root.querySelector(refocus); if (el) el.focus({ preventScroll: true }); }
    return;
  }
  const body = HV.level === "country" ? `${hvVariableCard()}${hvTimelineChart()}${hvTimelineCard()}<div id="hvBody">${hvCountryBody()}</div>`
    : HV.level === "overview" ? `${hvOverviewCard()}${hvQuestionScroller()}`
    : `${hvVariableCard()}${hvWorldBody()}`;
  root.innerHTML = `<div class="hv-wrap">${head}${hvControls()}${body}</div>`;
  if (HV.level === "country") hvMarkChart();
  hvSync();
  if (refocus) { const el = root.querySelector(refocus); if (el) el.focus({ preventScroll: true }); }
  hvShowCurrent();
}
// The rolling list opens at the selected question.
function hvShowCurrent() {
  const box = document.querySelector("#hvRoll .hv-roll-box"), on = box && box.querySelector("li.on");
  if (on) box.scrollTop = Math.max(0, on.offsetTop - box.offsetTop - 60);
}

function hvControls() {
  const crumbs = [HV.level === "world" ? `<b>World</b>` : `<a href="${hvHref()}">World</a>`];
  if (HV.region && HV.level !== "timelines") crumbs.push(HV.level === "region" ? `<b>${esc(HV.region)}</b>` : `<a href="${hvHref({ r: HV.region })}">${esc(HV.region)}</a>`);
  if (HV.level === "country" || HV.level === "overview") crumbs.push(`<b>${esc(hvCountryName(HV.iso))}</b>`);
  // Questions grouped by construct; each construct, and all questions together, can be chosen too.
  const asked = HV.iso ? new Set(hvTotalsOfCountry(HV.iso).map(t => t.variable)) : null;
  const opt = x => `<option value="${esc(x.id)}"${x.id === HV.sel ? " selected" : ""}>${esc(x.name)}${x.question_type && x.question_type !== "judgement" && !x.name.toLowerCase().includes(hvQType(x).label.toLowerCase()) ? ` (${esc(hvQType(x).label.toLowerCase())})` : ""}${asked && !asked.has(x.id) ? " – not asked here" : ""}</option>`;
  const groups = hvConstructs().map(c => {
    const vs = hvVars().filter(v => v.construct === c.id).sort((a, b) => (asked ? asked.has(b.id) - asked.has(a.id) : 0) || a.name.localeCompare(b.name));
    return vs.length ? `<optgroup label="${esc(c.name)}"><option value="c:${esc(c.id)}"${HV.sel === `c:${c.id}` ? " selected" : ""}>All of: ${esc(c.name)} (${vs.length})</option>${vs.map(opt).join("")}</optgroup>` : "";
  }).join("");
  const varOptions = `<option value="all"${HV.sel === "all" ? " selected" : ""}>All questions (${hvVars().length})</option>${groups}`;
  const regions = hvList(HV.world.regions).map(r => r.region).sort((a, b) => a.localeCompare(b));
  const withData = new Set(hvSelTotals().map(t => t.iso3));
  const withAny = hvCountriesWithAny();
  // Every country with any question opens: one without the selected question shows the questions it has.
  const rank = iso => withData.has(iso) ? 2 : withAny.has(iso) ? 1 : 0;
  const countryGroups = regions.map(r => {
    const cs = HV.world.countries.filter(c => c.region === r).sort((a, b) => rank(b.iso3) - rank(a.iso3) || a.name.localeCompare(b.name));
    return `<optgroup label="${esc(r)}">${cs.map(c => `<option value="${esc(c.iso3)}"${withAny.has(c.iso3) ? "" : " disabled"}${c.iso3 === HV.iso ? " selected" : ""}>${esc(c.name)}${withData.has(c.iso3) ? "" : withAny.has(c.iso3) ? " (other questions)" : " (no data yet)"}</option>`).join("")}</optgroup>`;
  }).join("");
  return `<div class="hv-controls">
    <label class="field hv-varfield"><span>Question or construct</span>
      <select id="hvVar">${varOptions}</select></label>
    <label class="field"><span>Country</span>
      <select id="hvCountryPick"><option value="">${HV.level === "timelines" ? "All countries" : "Choose a country"}</option>${countryGroups}</select></label>
    ${HV.level === "timelines" ? "" : `<nav class="hv-crumbs" aria-label="Where you are">${crumbs.join(` <span aria-hidden="true">›</span> `)}</nav>`}
    ${HV.level === "region" || HV.level === "country" ? hvMeasureSwitch() : ""}
  </div>`;
}
// Respondents or simple averages on the map.
function hvMeasureSwitch() {
  const can = hvHasAverage();
  const why = !HV.varId ? "Averages are for one question: choose one" : "This question has no protectionist side, so it has no average";
  const b = (id, label) => `<button type="button" class="btn small" data-measure="${id}" aria-pressed="${(id === "avg") === hvAverage()}"${id === "avg" && !can ? ` disabled title="${esc(why)}"` : ""}>${label}</button>`;
  return `<div class="field hv-measure" role="group" aria-label="What the map shows"><span>The map shows</span><div>${b("n", "Respondents")}${b("avg", "Average")}</div></div>`;
}

/* The questions as a rolling list below the map, grouped by construct: in a country those asked there, each with every
   observation on the 1980 to 2025 axis; elsewhere those of the selection, with how many countries have them. */
function hvQuestionScroller() {
  const inCountry = HV.level === "country" || HV.level === "overview";
  const totals = hvList(HV.index.country_totals).filter(t => inCountry ? t.iso3 === HV.iso : HV.level === "region" ? hvCountryRegion(t.iso3) === HV.region : true);
  const by = new Map();
  for (const t of totals) { if (!by.has(t.variable)) by.set(t.variable, []); by.get(t.variable).push(t); }
  const chosen = new Set(hvSelVars().map(v => v.id));
  const years = l => { const a = Math.min(...l.map(t => +t.first_year)), b = Math.max(...l.map(t => +t.last_year)); return a === b ? `${a}` : `${a}–${b}`; };
  const item = v => {
    const l = by.get(v.id), on = v.id === HV.varId;
    const extra = inCountry ? { c: HV.iso } : HV.level === "region" ? { r: HV.region } : {};
    const what = inCountry ? `${years(l)} · ${hvWavesText(l[0].waves)} · ${fmt(l[0].n)} respondents` : `${years(l)} · ${l.length} ${l.length === 1 ? "country" : "countries"}`;
    return `<li class="${on ? "on" : chosen.has(v.id) ? "" : "dim"}"><a href="${hvHref(extra, v.id)}"${on ? ` aria-current="page"` : ""}><span class="hv-roll-name">${esc(v.name)}${hvQTypeTag(v)}</span><span class="muted">${esc(what)}</span></a>${inCountry ? hvStrip(l[0]) : ""}</li>`;
  };
  // The selected construct (or the selected question's) comes first.
  const first = HV.varId ? hvVar().construct : hvSelConstruct() ? hvSelConstruct().id : null;
  const cons = hvConstructs().slice().sort((a, b) => (b.id === first) - (a.id === first));
  const groups = cons.map(c => {
    const vs = hvVars().filter(v => v.construct === c.id && by.has(v.id)).sort((a, b) => a.name.localeCompare(b.name));
    if (!vs.length) return "";
    const extra = inCountry ? { c: HV.iso } : HV.level === "region" ? { r: HV.region } : {};
    return `<h4><a href="${hvHref(extra, `c:${c.id}`)}">${esc(c.name)}</a> <span class="hv-tag">${vs.length}</span></h4><ul>${vs.map(item).join("")}</ul>`;
  }).join("");
  const n = [...by.keys()].length;
  const place = inCountry ? `in ${hvCountryName(HV.iso)}` : HV.level === "region" ? `in ${HV.region}` : "";
  return `<section class="card hv-roll" id="hvRoll"><h3>Questions ${esc(place)} <span class="hv-tag">${n} of ${hvVars().length}</span></h3>
    <p class="muted">${inCountry ? "Click one to see its timelines, map and coding here. Each dot is one wave, 1980 to 2025." : "Click one to see where it was asked. The map follows."}</p>
    <div class="hv-roll-box" tabindex="0" role="region" aria-label="Questions ${esc(place)}">${groups || `<p class="muted">No questions here yet.</p>`}</div></section>`;
}
// A question's observations in one country on the 1980 to 2025 axis, small.
function hvStrip(t) {
  const obs = hvList(t.obs);
  return `<span class="hv-strip" aria-hidden="true">${obs.map(o => `<i style="left:${hvAxisPct(o.date)}%" title="${esc(String(o.wave).replace(":", " "))}, ${esc(String(o.date).slice(0, 4))}"></i>`).join("")}</span>`;
}
// What the country page shows when no single question with data here is selected.
function hvOverviewCard() {
  const name = esc(hvCountryName(HV.iso));
  if (HV.varId) return `<section class="card hv-var"><h3>${name}</h3>
    <p class="muted">${esc(hvVar().name)} has no data for ${name} yet. The questions below do.</p></section>`;
  const s = hvCountrySummary().get(HV.iso), c = hvSelConstruct();
  return `<section class="card hv-var"><h3>${name}: ${esc(hvSelName())}</h3>
    ${c ? `<p>${esc(c.definition)}.</p>` : ""}
    <p class="muted">${s ? `${hvQuestionsText(s.q)}, ${hvYearsText(s)}, ${fmt(s.n)} answers counted question by question. Choose a question for its timelines, map and coding.` : `No question of this construct has data for ${name} yet. The questions below do.`}</p></section>`;
}

/* Regions and countries as a list, for anyone who would rather not click the map. Those with the selection first. */
function hvBrowse(byIso, regionSum) {
  const inRegion = HV.level === "region";
  const regionQ = r => (regionSum.get(r) || { countries: 0 }).countries;
  const regions = (inRegion ? [HV.region] : hvList(HV.world.regions).map(r => r.region))
    .sort((a, b) => regionQ(b) - regionQ(a) || a.localeCompare(b));
  const what = s => HV.varId ? `${hvWavesText(s.waves)}, ${hvYearsText(s)}` : hvQuestionsText(s.q);
  const col = r => {
    const cs = HV.world.countries.filter(c => c.region === r).sort((a, b) => byIso.has(b.iso3) - byIso.has(a.iso3) || a.name.localeCompare(b.name));
    return `<div class="hv-browse-col">${inRegion ? "" : `<h4><a href="${hvHref({ r })}">${esc(r)}</a></h4>`}
      <ul>${cs.map(c => byIso.has(c.iso3)
        ? `<li><a href="${hvHref({ c: c.iso3 })}">${esc(hvCountryName(c.iso3))}</a> <span class="muted">${esc(what(byIso.get(c.iso3)))}</span></li>`
        : `<li class="hv-nodata">${esc(c.name)}</li>`).join("")}</ul></div>`;
  };
  return `<details class="card hv-browse"><summary><b>${inRegion ? `Countries in ${esc(HV.region)}` : "All regions and countries"}</b> <span class="muted">as a list</span></summary>
    <p class="muted">Countries with ${HV.varId ? "this question" : HV.sel === "all" ? "any question" : "a question of this construct"} are links. Grey names have none yet.</p>
    <div class="hv-browse-grid${inRegion ? " one" : ""}">${regions.map(col).join("")}</div></details>`;
}

function hvVariableCard() {
  if (!HV.varId) {
    const c = hvSelConstruct(), totals = hvSelTotals(), n = new Set(totals.map(t => t.iso3)).size;
    const y0 = Math.min(...totals.map(x => +x.first_year)), y1 = Math.max(...totals.map(x => +x.last_year));
    return `<section class="card hv-var"><h3>${esc(hvSelName())}</h3>
      ${c ? `<p>${esc(c.definition)}.</p>` : `<p>Every question harmonized so far, in ${hvConstructs().length} constructs.</p>`}
      <p class="muted">${hvQuestionsText(hvSelVars().length)} in ${n} countries, ${y0}–${y1}. Choose a question to see where it was asked, its timelines and how it was coded.</p></section>`;
  }
  const v = hvVar(), c = hvConstructs().find(x => x.id === v.construct);
  const t = hvTotalsOfVar();
  const y0 = Math.min(...t.map(x => +x.first_year)), y1 = Math.max(...t.map(x => +x.last_year));
  // Wordings and scales are read from the questionnaires; for a program whose questionnaires are not fetched yet there are none.
  const scales = +v.scales === 1 ? "one answer scale" : `${v.scales} answer scales`;
  const versions = !+v.wordings ? "the wording not yet read from a questionnaire"
    : `${+v.wordings === 1 ? "one wording" : `${v.wordings} versions of the wording`} and ${scales}`;
  const answersOpen = HV.level === "country" && hvList(HV.d.answers).some(a => a.status === "proposed");
  const regionsOpen = HV.level === "country" && hvList(HV.d.coding).some(x => x.status === "proposed");
  const tag = answersOpen ? "Coding proposed, not yet confirmed" : regionsOpen ? "Region coding proposed, not yet confirmed" : "";
  return `<section class="card hv-var"><h3>${esc(v.name)}${hvQTypeTag(v)}${tag ? ` <span class="hv-tag">${tag}</span>` : ""}</h3>
    ${c ? `<p class="hv-con"><a href="${hvHref(HV.level === "country" ? { c: HV.iso } : HV.region ? { r: HV.region } : {}, `c:${c.id}`)}">${esc(c.name)}</a></p>` : ""}
    <p>${esc(v.definition)}.</p>
    <p class="hv-qtype-line"><b>Question type: ${esc(hvQType(v).label)}.</b> ${esc(hvQType(v).text)}${hvTypeNote(v) ? ` <b>Note:</b> ${esc(hvTypeNote(v))}.` : ""}</p>
    <p class="muted">Asked in ${esc(hvList(v.programs).join(" and "))}, ${esc(y0)}–${esc(y1)}, with ${esc(versions)}. Harmonized so far for ${t.length} ${t.length === 1 ? "country" : "countries"}.</p></section>`;
}

/* ---------- world and region views ---------- */
function hvWorldBody() {
  // Country by country. The world map shows where the selection exists: how many waves of one question, or how many
  // questions. A region's map shows respondents or averages of one question.
  const byIso = hvCountrySummary();
  const regionSum = hvRegionSummary(byIso);
  const regions = hvList(HV.world.regions);
  const inRegionView = HV.level === "region";
  const view = inRegionView ? regions.find(r => r.region === HV.region) : HV_WORLD_VIEW;
  const lon0 = inRegionView ? Math.round((+view.lon_min + +view.lon_max) / 2) : 0;
  const shown = [...byIso.values()].filter(s => !inRegionView || hvCountryRegion(s.iso3) === HV.region);
  const avg = inRegionView && hvAverage();
  const value = s => avg ? s.avg : HV.varId ? (inRegionView ? s.n : s.waves) : s.q;
  const sc = avg ? hvShareScale(shown.map(value)) : hvScaleOf(shown.map(value));
  const unitName = avg ? "Average" : HV.varId ? (inRegionView ? "Respondents" : "Waves") : "Questions";
  const cls = s => avg ? hvShareClass(s.avg, sc) : `hv-c${hvClassOf(value(s), sc)}`;
  const label = s => avg ? `${hvPct(s.avg)} protectionist` : HV.varId ? (inRegionView ? `${fmt(s.n)} respondents` : `${hvWavesText(s.waves)}, ${hvYearsText(s)}`) : hvQuestionsText(s.q);
  const paths = HV.world.countries.map(c => {
    const name = esc(c.name), s = byIso.get(c.iso3), d = hvWorldPath(c, lon0);
    if (!inRegionView) return `<path class="hv-w ${s ? cls(s) : "hv-no"}" data-region="${esc(c.region)}" data-iso="${esc(c.iso3)}" data-name="${name}" d="${d}"></path>`;
    const inside = c.region === HV.region;
    if (s && inside) return `<path class="hv-w hv-go ${cls(s)}" data-country="${esc(c.iso3)}" data-name="${name}" d="${d}" tabindex="0" role="link" aria-label="${name}: ${esc(label(s))}"></path>`;
    return `<path class="hv-w hv-no${inside ? "" : " hv-out"}" data-name="${name}" d="${d}"></path>`;
  }).join("");
  const title = inRegionView ? `${HV.region}: click a country` : "World: click a region";
  const where = HV.varId ? hvVar().name : HV.sel === "all" ? "any question" : hvSelName();
  const sub = inRegionView
    ? `${hvSelName()}: ${shown.length} ${shown.length === 1 ? "country" : "countries"} of this region. ${avg ? "Simple average over all waves: the share of answers coded protectionist, unweighted. Darker means more protectionist." : `Darker means more ${unitName.toLowerCase()}.`}`
    : `${HV.varId ? `Where “${where}” was asked` : HV.sel === "all" ? "Where any question was asked" : `Where a question on ${where.toLowerCase()} was asked`}: ${byIso.size} countries. Darker means more ${unitName.toLowerCase()}.`;
  return `<div class="hv-main hv-main-world">
    <figure class="card hv-map hv-map-world">
      <figcaption><b>${esc(title)}</b><br><span class="muted">${esc(sub)}</span></figcaption>
      <svg viewBox="${hvFrame(view, lon0)}" role="group" aria-label="${esc(title)}">${inRegionView ? "" : hvGlobe()}<g>${paths}</g></svg>
      ${avg ? hvShareLegend(sc) : hvLegend(sc, "Not asked", unitName)}
      ${hvWorldCredit()}
    </figure>
    <aside class="card hv-panel">${inRegionView ? hvCountryList(byIso) : hvRegionList(regionSum)}</aside>
  </div>
  ${hvQuestionScroller()}
  ${hvBrowse(byIso, regionSum)}`;
}

function hvRegionList(regionSum) {
  const rows = [...regionSum.entries()].sort((a, b) => b[1].countries - a[1].countries || a[0].localeCompare(b[0]));
  const one = !!HV.varId;
  return `<h3>Regions</h3>
    <div class="hv-scroll"><table class="occ"><thead><tr><th>Region</th><th class="num">Countries</th><th class="num">${one ? "Waves" : "Questions"}</th></tr></thead>
    <tbody>${rows.map(([r, s]) => `<tr class="row" data-goregion="${esc(r)}" tabindex="0"><td>${esc(r)}</td><td class="num">${s.q ? s.countries : "–"}</td><td class="num">${s.q ? (one ? s.waves : s.q) : `<span class="muted">Not asked</span>`}</td></tr>`).join("")}</tbody></table></div>`;
}

function hvCountryList(byIso) {
  const members = HV.world.countries.filter(c => c.region === HV.region);
  const withData = members.filter(c => byIso.has(c.iso3)).sort((a, b) => hvAverage() ? byIso.get(b.iso3).avg - byIso.get(a.iso3).avg : byIso.get(b.iso3).n - byIso.get(a.iso3).n);
  const others = members.length - withData.length, one = !!HV.varId;
  const table = `<div class="hv-scroll"><table class="occ"><thead><tr><th>Country</th>${one ? `<th class="num">Waves</th><th class="num">Respondents</th>${hvHasAverage() ? `<th class="num">Average</th>` : ""}` : `<th class="num">Questions</th>`}<th>Years</th></tr></thead>
    <tbody>${withData.map(c => { const s = byIso.get(c.iso3); return `<tr class="row" data-country="${esc(c.iso3)}" tabindex="0"><td>${esc(hvCountryName(c.iso3))}</td>${one ? `<td class="num">${s.waves}</td><td class="num">${fmt(s.n)}</td>${hvHasAverage() ? `<td class="num">${hvPct(s.avg)}</td>` : ""}` : `<td class="num">${s.q}</td>`}<td class="hv-nowrap">${esc(hvYearsText(s))}</td></tr>`; }).join("")}</tbody></table></div>`;
  return `<h3>${esc(HV.region)}</h3>
    ${withData.length ? table : `<p class="muted">No country in this region has ${one ? "this question" : "data"} yet.</p>`}
    ${withData.length && others ? `<p class="muted hv-after">The other ${others} countries in this region have none yet.</p>` : ""}`;
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
  for (const k of hvList(t.waves)) { const n = hvWave(k).fine_units; if (n != null && seq[seq.length - 1] !== n) seq.push(n); }
  return seq;
}
const hvRegionsText = n => `${n} ${n === 1 ? "region" : "regions"}`;
const hvIsJoined = t => t.scheme === "stable" || String(t.scheme).startsWith("joined-");
const hvTlTitle = t => t.all ? "All observations" : t.level ? hvRegionsText(t.n_units) : `Finest in each wave`;
const hvTlSub = t => t.all ? "not harmonized across waves" : t.level ? hvLevelLabel(t.level_label) : `${hvLevelSeq(t).join(", then ")} regions`;
// A date's place on the axis every timeline shares, 1980 to the end of 2025.
const hvAxisPct = d => { const a = Date.UTC(HV_Y0, 0, 1), b = Date.UTC(HV_Y1 + 1, 0, 1); return Math.max(0, Math.min(100, 100 * (Date.parse(String(d).slice(0, 10) + "T00:00:00Z") - a) / (b - a))).toFixed(2); };
function hvAxisHtml() {
  let axis = "", grid = "";
  for (let y = HV_Y0; y <= HV_Y1; y += 5) {
    axis += `<span class="hv-ax" style="left:${hvAxisPct(`${y}-01-01`)}%">${y}</span>`;
    grid += `<i class="hv-gl" style="left:${hvAxisPct(`${y}-01-01`)}%"></i>`;
  }
  return { axis, grid };
}

function hvTimelineChart() {
  const { axis, grid } = hvAxisHtml();
  const whole = hvAllTimeline();
  const groups = new Map();
  for (const t of hvTimelines()) {
    const key = hvList(t.instruments).join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const order = [...groups.values()].sort((a, b) => hvList(b[0].instruments).length - hvList(a[0].instruments).length || Math.max(...b.map(t => t.n_waves)) - Math.max(...a.map(t => t.n_waves)));
  const dots = (t, ws) => ws.map(w => {
    const flag = hvFlagKinds(hvChangesAt(t, w.wave_key)).length > 0;
    return `<button type="button" class="hv-dot${flag ? " chg" : ""}" style="left:${hvAxisPct(w.date)}%" data-wave="${esc(w.wave_key)}" aria-label="${esc(hvWaveLabel(w))}, ${esc(hvMonth(w))}"></button>`;
  }).join("");
  const row = (t, cls = "") => {
    const ws = hvList(t.waves).map(hvWave).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const a = hvAxisPct(ws[0].date), b = hvAxisPct(ws[ws.length - 1].date);
    return `<div class="hv-tl-row ${cls}" data-timeline="${esc(t.id)}">
      <button type="button" class="hv-tl-label" data-pick="${esc(t.id)}"><b>${esc(hvTlTitle(t))}</b> <span>${esc(hvTlSub(t))}</span><br><span class="muted">${hvWavesText(t.n_waves)}, ${esc(hvTlYears(t))}</span></button>
      <div class="hv-tl-track">${grid}<i class="hv-tl-line${t.all ? " none" : ""}" style="left:${a}%;width:${(b - a).toFixed(2)}%"></i>${dots(t, ws)}</div>
    </div>`;
  };
  const head = g => {
    const inGroup = new Set(g.flatMap(t => hvList(t.waves).map(hvProgramOf)));
    const programs = HV.programs.filter(p => inGroup.has(p));
    const same = hvList(g[0].instruments).length > 1;
    const across = programs.length > 1 ? " across programs" : "";
    // H1: the same question in the questionnaires; H2: the same statement with another answer scale, so bin only.
    const text = !same ? "One instrument: the same item in every wave"
      : String(g[0].tier || "").startsWith("H2") ? `The same statement${across}, with a changed answer scale: shown as protectionist or not only`
      : `The same question in several versions${across}, checked in the questionnaires`;
    return `<div class="hv-tl-group"><b>${esc(programs.join(" and "))}</b> <span class="muted">${esc(text)}</span></div>`;
  };
  // Every observation, program by program.
  const wavesOnce = whole.waves.map(hvWave);
  const perProgram = HV.programs.length > 1 ? `<details class="hv-progs" id="hvProgs"${HV.progsOpen ? " open" : ""}><summary>Program by program</summary>${HV.programs.map(p => {
    const ws = wavesOnce.filter(w => w.program === p);
    return `<div class="hv-tl-row hv-tl-prog" data-timeline="all"><div class="hv-tl-label">${esc(p)} <span class="muted">${hvWavesText(ws.length)}</span></div><div class="hv-tl-track">${grid}${dots(whole, ws)}</div></div>`;
  }).join("")}</details>` : "";
  const bySpecific = g => g.slice().sort((a, b) => hvLevelRank(a) - hvLevelRank(b) || b.n_units - a.n_units || String(a.start).localeCompare(String(b.start)));
  return `<section class="card hv-tl" id="hvTimelines">
    <h3>Timelines in ${esc(hvCountryName(HV.iso))}</h3>
    <p class="muted">Every wave of this question, 1980 to 2025, and below it each way it can be followed over time: which questions a timeline joins, and at which level of geography (the most detailed first). Click a row to see that timeline on the map, or a dot for one wave.</p>
    <div class="hv-tl-scroll"><div class="hv-tl-inner">
      <div class="hv-tl-row hv-tl-axis"><div class="hv-tl-label"></div><div class="hv-tl-track">${axis}</div></div>
      ${row(whole, "hv-tl-all")}
      ${perProgram}
      ${order.length ? `<div class="hv-tl-sep">Harmonized timelines</div>${order.map(g => head(g) + bySpecific(g).map(t => row(t)).join("")).join("")}` : `<p class="muted hv-tl-none">${esc(hvNoTimelineText())}</p>`}
    </div></div>
    <div class="hv-legend"><span class="hv-key"><i class="hv-dot-key"></i>One wave</span><span class="hv-key"><i class="hv-flag"></i>Something about the question or coding changes here</span></div>
  </section>`;
}
// How specific a timeline's geography is: the most detailed first, then areas of the survey's own, joined regions and mixed levels.
function hvLevelRank(t) {
  if (t.all) return -1;
  const l = String(t.level_label || "");
  const at = ["NUTS 3", "ADM 3", "ADM 2", "NUTS 2", "ADM 1", "NUTS 1"].findIndex(x => l.startsWith(x));
  return at >= 0 ? at : /survey/i.test(l) ? 7 : l === "COMPOSITE" ? 8 : /^Joined/.test(l) ? 9 : 10;
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
  const rel = !t.all && inst.length > 1 ? hvList(HV.d.relations).find(r => inst.includes(r.instrument_a) && inst.includes(r.instrument_b)) : null;
  const seq = hvLevelSeq(t);
  const joined = hvIsJoined(t) && !t.all;
  const changing = hvList(t.all_waves).length > 0;
  const levelText = t.all ? `The finest coding each wave has. With all waves selected, the map joins regions that differ between waves.`
    : joined
    ? `${hvRegionsText(t.n_units)}. Regions that changed between waves are joined, and the rest stay at their lowest level, so the same area is compared in all ${t.n_waves} waves.`
    : t.level
    ? `${hvRegionsText(t.n_units)} at ${hvLevelLabel(t.level_label)}. Reaches ${t.n_waves} of ${hvWaveCount(HV.d.waves)} waves in ${hvCountryName(HV.iso)}.${changing ? " Some regions change along the way, so they are not the same area in every wave. With all waves selected, the map joins them." : ""}`
    : `The finest coding each wave has, so the regions change from ${seq.join(" to ")} along the way. With all waves selected, the map shows regions that stay the same.`;
  const questions = t.all ? "Every wave of this question, in every version. They are one concept, but only the harmonized timelines are comparable across waves."
    : rel ? esc(rel.rationale) + (rel.status === "proposed" ? ". This join is proposed, not yet confirmed." : "") : "One instrument: the same item in every wave of this program.";
  let lastYear = null;
  const ticks = waves.map((w, n) => {
    const y = hvYear(w), label = y !== lastYear ? y : "";
    lastYear = y;
    return `<span class="hv-tick" style="left:${waves.length > 1 ? (100 * n / (waves.length - 1)).toFixed(3) : 0}%">${esc(label)}</span>`;
  }).join("");
  return `<section class="card hv-time${i < 0 ? " idle" : ""}" id="hvTime">
    <div class="hv-tl-now"><h3>${t.all ? "All observations" : `${esc(programs.join(" and "))}: ${esc(hvTlTitle(t))}${t.level ? ` (${esc(hvLevelLabel(t.level_label))})` : ""}`}, ${esc(hvTlYears(t))}</h3>
      <dl class="hv-meta">
        <dt>Questions</dt><dd>${questions}</dd>
        <dt>Geography</dt><dd>${esc(levelText)}</dd>
        ${t.all ? "" : `<dt>Available as</dt><dd>${hvList(t.forms).map(f => esc(HV_FORMS[f] || f)).join("; ")}</dd>`}
      </dl></div>
    <div class="hv-time-row">
      <button type="button" class="btn small" id="hvAllWaves" aria-pressed="${i < 0}">All waves</button>
      <div class="hv-slide">
        <div class="hv-now" id="hvNow" aria-live="polite">${esc(hvNowText())}</div>
        <input type="range" id="hvSlider" min="0" max="${waves.length - 1}" step="1" value="${Math.max(0, i)}" aria-label="Wave" aria-valuetext="${esc(hvNowText())}">
        <div class="hv-ticks${waves.length > 24 ? " many" : ""}" aria-hidden="true">${ticks}</div>
      </div>
    </div>
  </section>`;
}
function hvNowText() {
  if (hvIsAll()) {
    const w = hvTlWaves();
    return `${w.length === 1 ? "One wave" : `All ${w.length} waves`} in this timeline, ${hvYear(w[0])}–${hvYear(w[w.length - 1])}.${w.length > 1 ? " Move the slider to see one wave." : ""}`;
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
    ${hvQuestionScroller()}
    ${hvChangesCard()}
    ${hvQuestions()}
    ${hvNotCoded()}
    ${hvRegionTable(totals)}`;
}

function hvRedrawBody(refocus) {
  const body = $("#hvBody");
  if (!body) return hvDraw(refocus);
  const roll = body.querySelector(".hv-roll-box"), at = roll ? roll.scrollTop : null;
  body.innerHTML = hvCountryBody();
  if (at != null && body.querySelector(".hv-roll-box")) body.querySelector(".hv-roll-box").scrollTop = at;
  hvMarkChart();
  hvSync();
  if (refocus) { const el = $("#harmonizedView").querySelector(refocus); if (el) el.focus({ preventScroll: true }); }
}

function hvMap(totals) {
  const { shapes } = HV;
  if (!shapes.view_box || !shapes.outline) {
    const n = [...totals.values()].reduce((a, b) => a + b, 0);
    return `<figure class="card hv-map"><figcaption><b>No map for ${esc(hvCountryName(HV.iso))}</b><br><span class="muted">No boundary source has regions for this territory. ${n ? `${fmt(n)} respondents in ${hvRegionsText(totals.size)} are listed below.` : "The respondents and why they have no region are listed below."}</span></figcaption></figure>`;
  }
  const avg = hvAverage(), means = avg ? hvAverages(hvValuesInView()) : new Map();
  const share = id => { const a = means.get(id); return a ? hvShare(a.pro, a.bin) : null; };
  const sc = avg ? hvShareScale([...totals.keys()].map(share)) : hvIsAll() ? HV.scale.all : HV.scale.wave;
  const fill = r => avg ? hvShareClass(share(r.id), sc) : `hv-c${hvClassOf(r.n, sc)}`;
  const regions = [...totals.keys()].map(id => ({ id, n: totals.get(id), d: shapes.paths[id] })).filter(r => r.d);
  // The selected region is drawn last, so its outline sits on top of its neighbours.
  regions.sort((a, b) => (a.id === HV.unit) - (b.id === HV.unit));
  const paths = regions.map(r => `<path class="hv-r ${fill(r)}${r.id === HV.unit ? " sel" : ""}" data-unit="${esc(r.id)}" d="${r.d}" tabindex="0" role="button"
      aria-pressed="${r.id === HV.unit}" aria-label="${esc(hvName(r.id))}: ${avg ? `${hvPct(share(r.id))} protectionist, ` : ""}${fmt(r.n)} respondents"></path>`).join("");
  const onMap = regions.reduce((a, r) => a + r.n, 0);
  // Regions no source gives a boundary for stay off the map and in the table below.
  const noShape = [...totals.keys()].filter(id => !shapes.paths[id]);
  const noShapeN = noShape.reduce((a, id) => a + totals.get(id), 0);
  const off = hvCellsInView().filter(c => !c.unit).reduce((a, c) => a + c.n, 0);
  const w = hvIsAll() ? null : hvWave(HV.wave);
  const title = w ? `${hvWaveLabel(w)}, ${hvYear(w)}: ${hvRegionsText(totals.size)}` : `All waves${HV.tl.all ? "" : " in this timeline"}: ${hvRegionsText(totals.size)}`;
  const national = avg ? hvCountryAverage(w ? w.wave_key : null) : null;
  // Parts of a country drawn beside the rest (Alaska, Hawaii) sit in a thin frame, and the caption says so.
  const insets = hvList(shapes.insets);
  const frames = insets.map(b => { const [x, y, bw, bh] = String(b.box).split(" ").map(Number); return `<rect class="hv-inset" x="${x}" y="${y}" width="${bw}" height="${bh}"></rect>`; }).join("");
  const leftOut = hvList(shapes.left_out).map(b => b.name || b.unit_id);
  const notes = [...insets.map(b => esc(b.note)), ...(leftOut.length ? [`Not drawn, with no data: ${esc(leftOut.join(", "))}`] : [])];
  const insetNote = notes.length ? ` · ${notes.join(". ")}.` : "";
  return `<figure class="card hv-map">
    <figcaption><b>${esc(title)}</b><br><span class="muted">${fmt(onMap)} respondents on the map${noShape.length ? ` · ${fmt(noShapeN)} in ${noShape.length} ${noShape.length === 1 ? "region" : "regions"} with no boundary to draw (listed below)` : ""}${off ? ` · ${fmt(off)} could not be coded (listed below)` : ""}${insetNote}</span></figcaption>
    <svg viewBox="${esc(shapes.view_box)}" role="group" aria-label="Map of ${esc(hvCountryName(HV.iso))}: respondents per region">
      <path class="hv-base" d="${shapes.outline}"></path>
      ${frames}
      ${paths}
    </svg>
    ${avg ? `<p class="hv-avg-note">Simple average: the share of answers coded protectionist (1) among those coded 1 or 0, unweighted. The whole country: <b>${hvPct(hvShare(national.pro, national.bin))}</b> of ${fmt(national.bin)} answers.</p>${hvShareLegend(sc)}` : hvLegend(sc, "No data")}
    ${hvCredit()}
  </figure>`;
}
// The legend of averages.
function hvShareLegend(sc) {
  const items = [];
  for (let i = 0; i < sc.count; i++) {
    const a = (sc.first + i) * sc.step, b = a + sc.step;
    items.push(`<span class="hv-key"><i class="hv-sw hv-a${hvShareColor(i, sc.count)}"></i>${a}–${b >= 100 ? 100 : b - 1}%</span>`);
  }
  return `<div class="hv-legend" aria-label="Legend: average"><span class="hv-legend-title">Protectionist</span>${items.join("")}<span class="hv-key"><i class="hv-sw hv-none"></i>No answers coded 1 or 0</span></div>`;
}

function hvLegend(sc, none, title = "Respondents") {
  const count = sc.breaks.length + 1;
  const edges = [0, ...sc.breaks, sc.max];
  const items = [];
  if (sc.max) for (let i = 0; i < count; i++) {
    const lo = edges[i] + 1, hi = edges[i + 1];
    items.push(`<span class="hv-key"><i class="hv-sw hv-c${hvClass(i, count)}"></i>${lo === hi || count === 1 ? fmt(hi) : `${fmt(lo)}–${fmt(hi)}`}</span>`);
  }
  return `<div class="hv-legend" aria-label="Legend: ${esc(title.toLowerCase())}"><span class="hv-legend-title">${esc(title)}</span>${items.join("")}<span class="hv-key"><i class="hv-sw hv-none"></i>${esc(none)}</span></div>`;
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
    <p>Click a dot on a timeline, or move the slider, to see a wave's question and which answers were coded to what.</p>
    <p>Click a region to see the source data that make it up, then a source to see how its region codes were coded.</p>
    <p class="muted">${hvRegionsText(totals.size)} in this ${HV.tl.all ? "view" : "timeline"}.</p>`;
}

/* The depth of the coding in one wave: the question as asked, what each answer was coded to, how regions were coded. */
function hvWavePanel() {
  const w = hvWave(HV.wave), vars = hvWaveVars(HV.wave);
  const changes = hvChangeTexts(hvFlagKinds(hvChangesAt(HV.tl, w.wave_key)));
  const sources = [...new Set(hvCellsInView().map(c => c.source))];
  return `<div class="hv-panel-head"><h3>${esc(hvWaveLabel(w))}, ${esc(hvMonth(w))}</h3><button type="button" class="btn small" id="hvCloseWave">All waves</button></div>
    ${changes.length ? `<div class="hv-note"><b>Changes at this wave</b><ul>${changes.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}
    ${vars.length > 1 ? `<p class="muted">${vars.length} variables feed this wave, each asked of other respondents: ${vars.map(v => `<code>${esc(v.variable)}</code>${hvVarWho(v)}`).join(", ")}. Nobody is counted twice.</p>` : ""}
    ${hvNotUsedNote(hvNotUsed(w.wave_key), "Not used from this wave")}
    ${vars.map(v => hvQuestionBlock(v, vars.length > 1)).join("")}
    <h4>How its regions were coded</h4>
    <p class="muted">${w.fine_units} regions coded${w.coded_level ? ` at ${esc(w.coded_level)}` : ""}${HV.tl.level && HV.tl.level_label !== w.coded_level ? `, counted at ${esc(HV.tl.level_label)} in this timeline` : ""}. Click a source for every code.</p>
    <div class="hv-srcs">${sources.map(s => `<button type="button" class="btn small" data-src="${esc(s)}">${esc(hvSourceLabel(s))}</button>`).join("")}</div>`;
}
// Whom a variable was asked of, where a wave has several.
function hvVarWho(w) {
  const who = [...new Set(String(w.sources || "").split(";").filter(Boolean).map(hvSubsample).filter(Boolean))];
  return who.length ? ` (${esc(who.join(", "))})` : "";
}
const hvNotUsedText = x => x.note + (x.status === "proposed" ? " This choice is proposed, not yet confirmed." : "");
const hvNotUsedNote = (list, head) => list.length ? `<div class="hv-note"><b>${esc(head)}</b><ul>${[...new Set(list.map(hvNotUsedText))].map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
// Where a wave's data come from: the archive's page for the study, which also holds its questionnaire. Every questionnaire
// link goes there (Torkel, 2026-11-24); the document itself is the fallback where no study page is known.
const hvSourceUrl = w => w.study_page || w.questionnaire_url || null;
const hvSourceLink = (w, text) => { const u = hvSourceUrl(w); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener" title="The study's page where the data come from">${esc(text)}</a>` : esc(text); };
// One variable's question and what its answers were coded to.
function hvQuestionBlock(w, several) {
  const answers = hvList(HV.d.answers).filter(a => a.wave === w.wave_key && a.var === w.variable);
  const leftOut = x => x == null ? `<span class="muted">left out</span>` : esc(x);
  const row = (dt, dd) => dd ? `<dt>${esc(dt)}</dt><dd>${esc(dd)}</dd>` : "";
  return `<h4>The question${several ? `: <code>${esc(w.variable)}</code>${hvVarWho(w)}` : ""}</h4>
    <dl class="hv-meta">
      <dt>Question</dt><dd>${w.question_id ? `${esc(w.question_id)}${hvHasItem(w) ? `, item ${esc(w.item_no)}` : ""}${hvHas(w.page) ? `, page ${esc(w.page)} of the` : ", in the"} ${hvSourceLink(w, "questionnaire")}${hvHas(w.study) ? ` (study ${esc(w.study)})` : ""}`
        : `<span class="muted">The questionnaire for this wave is not fetched yet, so the wording below is the variable's label in the file.</span>`}</dd>
      <dt>Question type</dt><dd>${esc(hvQType(w).label)}${hvTypeNote(w) ? `. <b>${esc(hvTypeNote(w))}</b>` : ""}</dd>
      ${row("Wording", w.wording)}
      ${row("Answers offered", w.scale)}
      ${row("How it is asked", w.presentation)}
      ${row("Don't know", w.dk_presentation)}
      ${row("Interview mode", w.mode)}
      ${row("Definitions given", w.definition)}
      ${row("Note", w.notes)}
      <dt>In the file</dt><dd>${esc(w.file)}: <code>${esc(w.variable)}</code>${w.variable_label ? `, ${esc(w.variable_label)}` : ""} (${fmt(w.n)} respondents)</dd>
      <dt>Fieldwork</dt><dd>${esc(w.date_min)} to ${esc(w.date_max)}, from the ${esc(w.date_basis)}</dd>
    </dl>
    <h4>What the answers were coded to</h4>
    ${answers.some(a => a.status === "proposed") ? `<p class="muted">This coding is proposed, not yet confirmed.</p>` : ""}
    <div class="hv-scroll"><table class="occ"><thead><tr><th>Code</th><th>Label in the file</th><th class="num">Respondents</th><th>Coded as</th><th class="num">1 or 0</th><th class="num">Original scale</th><th>Why</th></tr></thead>
      <tbody>${answers.map(a => `<tr><td>${esc(a.code)}</td><td>${hvLabel(a.label)}</td><td class="num">${fmt(a.n)}</td><td>${esc(HV_CODED[a.coded] || a.coded)}</td><td class="num">${leftOut(a.bin)}</td><td class="num">${leftOut(a.orig)}</td><td class="hv-why">${esc(a.why || "")}</td></tr>`).join("")}</tbody></table></div>`;
}

// Waves in view where only some of a region's parts had respondents. The region is shown all the same, with this note.
function hvPartly(region) {
  const level = HV.tl && HV.tl.level ? hvList(HV.d.levels).find(l => l.id === HV.tl.level) : null;
  if (!level) return [];
  const keys = new Set(hvTlWaveKeys()), order = new Map(HV.d.waves.map((w, i) => [w.wave_key, i]));
  return hvList(level.partly)
    .filter(p => keys.has(p.wave) && (hvIsAll() ? hvTlGroup(p.unit) === region : p.wave === HV.wave && p.unit === region))
    .sort((a, b) => order.get(a.wave) - order.get(b.wave));
}
function hvPartlyNote(region) {
  const list = hvPartly(region);
  if (!list.length) return "";
  if (!hvIsAll()) return `<p class="muted">${fmt(list[0].parts)} of its ${fmt(list[0].parts_of)} parts had respondents in this wave.</p>`;
  const each = list.map(p => `${esc(hvWaveLabel(hvWave(p.wave)))}${p.unit === region ? "" : `, ${esc(hvName(p.unit))}`} (${fmt(p.parts)} of ${fmt(p.parts_of)})`).join(", ");
  const n = new Set(list.map(p => p.wave)).size;
  const head = `In ${n} ${n === 1 ? "wave" : "waves"}, only some of its parts had respondents`;
  return list.length <= 3 ? `<p class="muted">${head}: ${each}.</p>` : `<details class="hv-more"><summary>${head}</summary><p class="muted">${each}</p></details>`;
}

function hvRegionAverageNote(region) {
  const a = hvAverages(hvValuesInView()).get(region);
  return a && a.bin ? `<p>Simple average: <b>${hvPct(hvShare(a.pro, a.bin))}</b> protectionist, of ${fmt(a.bin)} answers coded 1 or 0.</p>` : "";
}

function hvRegionPanel(totals) {
  const cells = hvCellsInView().filter(c => c.unit && hvRegion(c.unit) === HV.unit);
  const waves = new Set(cells.map(c => c.wave));
  const parts = [...new Set(cells.map(c => c.unit))].filter(u => u !== HV.unit);
  const order = new Map(HV.d.waves.map((w, i) => [w.wave_key, i]));
  const rows = cells.slice().sort((a, b) => order.get(a.wave) - order.get(b.wave) || a.source.localeCompare(b.source) || String(a.code).localeCompare(String(b.code)));
  return `<div class="hv-panel-head"><h3>${esc(hvName(HV.unit))}</h3><button type="button" class="btn small" data-clear>Close</button></div>
    <p><b>${fmt(totals.get(HV.unit))}</b> respondents in ${waves.size} ${waves.size === 1 ? "wave" : "waves"}.${parts.length ? ` <span class="muted">Coded as ${esc(parts.map(hvName).join(", "))}${cells.some(c => c.unit === HV.unit) ? " in some waves" : ""}.</span>` : ""}</p>
    ${hvHasAverage() ? hvRegionAverageNote(HV.unit) : ""}
    ${hvPartlyNote(HV.unit)}
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
  const waves = hvTlQuestions();
  const notUsed = hvNotUsed(null);
  const fields = ["wording", "scale", "presentation", "dk_presentation", "mode", "definition"];
  const heads = { wording: "Wording", scale: "Answers offered", presentation: "How it is asked", dk_presentation: "Don't know", mode: "Mode", definition: "Definitions given" };
  const versions = f => new Set(waves.map(w => w[f])).size;
  const summary = fields.filter(f => versions(f) > 1).map(f => `${heads[f].toLowerCase()} ${versions(f)}`).join(", ");
  const rows = waves.map((w, i) => {
    const prev = waves[i - 1];
    const cells = fields.map(f => `<td class="${prev && prev[f] !== w[f] ? "hv-diff" : ""}">${esc(w[f])}</td>`).join("");
    return `<tr class="row${w.wave_key === HV.wave ? " on" : ""}" data-qwave="${esc(w.wave_key)}" tabindex="0"><td>${esc(hvYear(w))}</td><td>${esc(hvWaveLabel(w))}</td><td>${w.question_id ? `${esc(w.question_id)}${hvHasItem(w) ? `.${esc(w.item_no)}` : ""}${hvHas(w.page) ? `, p. ${esc(w.page)}` : ""}` : `<span class="muted">not read yet</span>`}</td><td><code>${esc(w.variable)}</code></td>${cells}</tr>`;
  }).join("");
  return `<section class="card hv-qs"><h3>Every question in this timeline</h3>
    <p class="muted">${hvWaveCount(waves)} waves. ${summary ? `Versions across them: ${esc(summary)}. ` : ""}Highlighted cells differ from the wave before. Click a wave for how its answers were coded.</p>
    <div class="hv-scroll"><table class="occ hv-qtable"><thead><tr><th>Year</th><th>Wave</th><th>Question</th><th>Variable</th>${fields.map(f => `<th>${esc(heads[f])}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    ${notUsed.length ? `<details class="hv-more"><summary>${notUsed.length} ${notUsed.length === 1 ? "variable" : "variables"} not used: each concept has one variable per wave</summary>
    <div class="hv-scroll"><table class="occ"><thead><tr><th>Wave</th><th>Not used</th><th>Used instead</th><th>Why</th></tr></thead>
    <tbody>${notUsed.map(x => `<tr><td>${esc(String(x.wave).replace(":", " "))}</td><td><code>${esc(x.variable)}</code> ${esc(x.variable_label || "")}</td><td><code>${esc(x.used_variable)}</code></td><td class="hv-why">${esc(hvNotUsedText(x))}</td></tr>`).join("")}</tbody></table></div></details>` : ""}</section>`;
}

function hvNotCoded() {
  const k = new Set(hvTlWaveKeys());
  const rows = hvList(HV.d.not_coded).filter(r => k.has(r.wave) && (hvIsAll() || r.wave === HV.wave));
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!rows.length) return `<section class="card hv-off"><h3>Not on the map</h3><p class="muted">Every respondent in this view has a region on the map.</p></section>`;
  return `<section class="card hv-off"><h3>Not on the map: could not be coded <span class="hv-tag">${fmt(total)} respondents</span></h3>
    <p class="muted">These respondents are kept in the data, but their region code is not tied to a region yet. The label is shown as it stands in the file, and the reason is beside it.</p>
    <div class="hv-scroll"><table class="occ"><thead><tr><th>Year</th><th>Source</th><th>Region variable</th><th>Code</th><th>Label in the file</th><th class="num">Respondents</th><th>Why</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="row" data-src="${esc(r.source)}" tabindex="0"><td>${esc(hvYear(hvWave(r.wave)))}</td><td>${esc(hvSourceLabel(r.source))}</td><td><code>${esc(r.var)}</code> ${esc(r.var_label || "")}</td><td>${esc(r.code)}</td><td>${hvLabel(r.label)}</td><td class="num">${fmt(r.n)}</td><td class="hv-why">${esc(r.reason || "")}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function hvRegionTable(totals) {
  const means = hvHasAverage() ? hvAverages(hvValuesInView()) : null;
  const rows = [...totals.entries()].map(([id, n]) => ({ id, n, name: hvName(id), a: means && means.get(id) })).sort((a, b) => a.name.localeCompare(b.name));
  return `<section class="card hv-table"><h3>All regions in this view</h3>
    <div class="hv-scroll"><table class="occ"><thead><tr><th>Region</th><th class="num">Respondents</th>${means ? `<th class="num">Answers coded 1 or 0</th><th class="num">Average</th>` : ""}</tr></thead>
    <tbody>${rows.map(r => `<tr class="row${r.id === HV.unit ? " on" : ""}" data-unit="${esc(r.id)}" tabindex="0"><td>${esc(r.name)}${HV.shapes.paths[r.id] ? "" : ` <span class="muted">(no boundary on the map)</span>`}</td><td class="num">${fmt(r.n)}</td>${means ? `<td class="num">${r.a ? fmt(r.a.bin) : "–"}</td><td class="num">${r.a ? hvPct(hvShare(r.a.pro, r.a.bin)) : "–"}</td>` : ""}</tr>`).join("")}</tbody></table></div></section>`;
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
    // A row shows its whole timeline; a dot shows its wave.
    HV.wave = wave || "all";
    hvSelectTimeline(id);
    hvDraw();
    return;
  }
  if (wave) hvSetWave(wave);
  else if (!hvIsAll()) hvSetWave("all");
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
    if (htOnClick(e.target)) return;
    const measure = e.target.closest("[data-measure]");
    if (measure) { if (!measure.disabled && HV.measure !== measure.dataset.measure) { HV.measure = measure.dataset.measure; hvDraw(`[data-measure="${HV.measure}"]`); } return; }
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
    if (e.target.id === "hvProgs") HV.progsOpen = e.target.open;
    htOnToggle(e.target);
    const b = e.target.dataset && e.target.dataset.hxblock;
    if (!b) return;
    (e.target.open ? HX.opened : HX.closed).add(b);
    (e.target.open ? HX.closed : HX.opened).delete(b);
  }, true);
  root.addEventListener("change", e => {
    if (hxOnChange(e.target) || htOnChange(e.target)) return;
    if (["hvVar", "hvCountryPick"].includes(e.target.id)) HV.refocus = `#${e.target.id}`;
    if (e.target.id === "hvVar") {
      // A new selection keeps you where you are: the country (its page, or its questions if this one was not asked
      // there), the region, or the Timelines tab.
      const stay = HV.level === "timelines" ? { tab: "timelines", ...(HV.iso ? { c: HV.iso } : {}) }
        : (HV.level === "country" || HV.level === "overview") ? { c: HV.iso } : HV.region ? { r: HV.region } : {};
      location.hash = hvHref(stay, e.target.value).slice(1);
    }
    if (e.target.id === "hvCountryPick") {
      if (HV.level === "timelines") location.hash = hvHref({ tab: "timelines", ...(e.target.value ? { c: e.target.value } : {}) }).slice(1);
      else if (e.target.value) location.hash = hvHref({ c: e.target.value }).slice(1);
    }
  });
  root.addEventListener("mousemove", e => {
    const d = e.target.closest(".hv-dot");
    if (d) {
      const w = hvWave(d.dataset.wave), id = d.closest(".hv-tl-row").dataset.timeline, t = id === "all" ? hvAllTimeline() : hvTimelines().find(x => x.id === id);
      const changes = hvChangeTexts(hvFlagKinds(hvChangesAt(t, w.wave_key)));
      return tipAt(e, `<b>${esc(hvWaveLabel(w))}, ${esc(hvMonth(w))}</b>${fmt(w.n)} respondents, ${w.fine_units == null ? "no regions" : `${esc(w.fine_units)} regions`} coded${changes.length ? `<br>${changes.map(esc).join("<br>")}` : ""}`);
    }
    const pt = e.target.closest(".ht-dot[data-tip]");
    if (pt) return tipAt(e, esc(pt.dataset.tip));
    const u = e.target.closest("path[data-unit]");
    if (u) {
      const n = hvTotals(hvCellsInView()).get(u.dataset.unit) || 0;
      const a = hvHasAverage() ? hvAverages(hvValuesInView()).get(u.dataset.unit) : null;
      return tipAt(e, `<b>${esc(hvName(u.dataset.unit))}</b>${fmt(n)} respondents${a && a.bin ? `<br>${hvPct(hvShare(a.pro, a.bin))} protectionist` : ""}`);
    }
    if (e.target.closest(".hv-base")) return tipAt(e, "No data in this view");
    const w = e.target.closest("path.hv-w");
    if (w) {
      hvHoverRegion(w.dataset.region || null);
      const iso = w.dataset.iso || w.dataset.country, s = iso ? hvCountrySummary().get(iso) : null;
      const what = s ? `${HV.varId ? hvWavesText(s.waves) : hvQuestionsText(s.q)}, ${esc(hvYearsText(s))}${HV.varId ? `<br>${fmt(s.n)} respondents${hvHasAverage() && s.avg != null ? `, ${hvPct(s.avg)} protectionist` : ""}` : ""}` : HV.varId ? "Not asked" : "No data yet";
      if (w.dataset.region) return tipAt(e, `<b>${esc(w.dataset.name)}</b>${what}<br><span class="muted">Click for ${esc(w.dataset.region)}</span>`);
      return tipAt(e, `<b>${esc(w.dataset.name)}</b>${what}`);
    }
    hvHoverRegion(null);
    tipAt(null, null);
  });
  root.addEventListener("mouseleave", () => { hvHoverRegion(null); tipAt(null, null); });
}
