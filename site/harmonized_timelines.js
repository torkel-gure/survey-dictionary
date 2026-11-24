"use strict";
/* Timelines tab of the Harmonized variables: every timeline, grouped by construct and question (cells merged where
   several timelines belong to one question), on the 1980 to 2025 axis, with the countries each applies to. The question,
   construct and country chosen above the list decide what it shows. A country's name opens its page at that timeline.
   Ticked timelines download as the same ZIP the export page makes; the list itself downloads as CSV. */

const HT = { picked: new Set(), folded: new Set(), busy: false, message: "", sep: "," };
const HT_MAX = 400; // timelines in one download: each brings its country's files

const htKey = (variable, iso, id) => `${variable}|${iso}|${id}`;
const htObs = (variable, iso) => hvList((hvList(HV.index.country_totals).find(t => t.variable === variable && t.iso3 === iso) || {}).obs);

// What the selection leaves, as one entry per question: its rows, the most detailed geography first within each series.
function htQuestions() {
  const ids = new Set(hvSelVars().map(v => v.id));
  const here = x => ids.has(x.variable) && (!HV.iso || x.iso3 === HV.iso);
  const byVar = new Map();
  const of = v => { if (!byVar.has(v)) byVar.set(v, { totals: [], timelines: [] }); return byVar.get(v); };
  for (const t of hvList(HV.index.country_totals)) if (here(t)) of(t.variable).totals.push(t);
  for (const t of HV.timelines) if (here(t)) of(t.variable).timelines.push(t);
  const dateOf = new Map();
  for (const t of hvList(HV.index.country_totals)) if (ids.has(t.variable)) for (const o of hvList(t.obs)) dateOf.set(`${t.variable}|${t.iso3}|${o.wave}`, o.date);
  const out = new Map();
  for (const [variable, x] of byVar) {
    const all = {
      head: "Every observation", text: "Each wave as it is, not harmonized across waves", level: "All observations", rank: -1, all: true,
      items: x.totals.map(t => ({ iso: t.iso3, id: "all", n_waves: +t.waves, n_units: null, start: t.first_year, end: t.last_year, dates: hvList(t.obs).map(o => o.date) })),
    };
    const series = new Map();
    for (const t of x.timelines) {
      const key = hvList(t.instruments).join("|");
      if (!series.has(key)) series.set(key, new Map());
      const label = t.level_label ? hvLevelLabel(t.level_label) : "Finest in each wave";
      const rows = series.get(key);
      if (!rows.has(label)) rows.set(label, { level: label, rank: hvLevelRank(t), tier: t.tier, instruments: hvList(t.instruments), items: [] });
      rows.get(label).items.push({ iso: t.iso3, id: t.id, n_waves: t.n_waves, n_units: t.n_units, start: t.start, end: t.end, t, dates: hvList(t.waves).map(k => dateOf.get(`${variable}|${t.iso3}|${k}`)).filter(Boolean) });
    }
    const list = [...series.values()].map(rows => {
      const r = [...rows.values()].sort((a, b) => a.rank - b.rank || Math.max(...b.items.map(i => i.n_units)) - Math.max(...a.items.map(i => i.n_units)));
      const programs = [...new Set(r.flatMap(x => x.items.flatMap(i => hvList(i.t.waves).map(hvProgramOf))))].sort();
      const several = r[0].instruments.length > 1;
      return {
        head: programs.join(" and "), rows: r,
        text: !several ? "One instrument: the same item in every wave" : String(r[0].tier || "").startsWith("H2") ? "The same statement with a changed answer scale" : "The same question in several versions",
        size: Math.max(...r.flatMap(x => x.items.map(i => i.n_waves))),
      };
    }).sort((a, b) => b.size - a.size || a.head.localeCompare(b.head));
    out.set(variable, [{ head: all.head, text: all.text, rows: [all] }, ...list]);
  }
  return out;
}

const htRange = (a, b) => a === b ? `${a}` : `${a}–${b}`;
const htYears = items => htRange(Math.min(...items.map(i => +String(i.start).slice(0, 4))), Math.max(...items.map(i => +String(i.end).slice(0, 4))));

// One row's years on the axis: a line from its first to its last wave, and a mark for each year with a wave. With several
// countries a taller mark means more of them.
// A click opens the country with the most waves in the row.
function htStrip(variable, row) {
  const years = new Map();
  for (const i of row.items) for (const y of new Set(i.dates.map(d => String(d).slice(0, 4)))) years.set(y, (years.get(y) || 0) + 1);
  const ys = [...years.keys()].sort();
  if (!ys.length) return "";
  const n = row.items.length;
  const a = hvAxisPct(`${ys[0]}-07-01`), b = hvAxisPct(`${ys[ys.length - 1]}-07-01`);
  const best = row.items.slice().sort((x, y) => y.n_waves - x.n_waves || hvCountryName(x.iso).localeCompare(hvCountryName(y.iso)))[0];
  return `<a class="ht-strip" href="${hvHref({ c: best.iso, t: best.id }, variable)}" aria-label="Open ${esc(hvCountryName(best.iso))}, ${esc(hvWavesText(best.n_waves))}">${row.all ? "" : `<i class="ht-line" style="left:${a}%;width:${(b - a).toFixed(2)}%"></i>`}${ys.map(y => {
    const c = years.get(y), h = n === 1 ? 50 : 20 + Math.round(70 * Math.sqrt(c / n));
    return `<i class="ht-dot" style="left:${hvAxisPct(`${y}-07-01`)}%;height:${h}%" data-tip="${esc(y)}: ${n === 1 ? "a wave" : `${c} of ${n} countries`}"></i>`;
  }).join("")}</a>`;
}

function htCountries(variable, row) {
  const byIso = new Map();
  for (const i of row.items) { if (!byIso.has(i.iso)) byIso.set(i.iso, []); byIso.get(i.iso).push(i); }
  const list = [...byIso.entries()].sort((a, b) => hvCountryName(a[0]).localeCompare(hvCountryName(b[0])));
  return `<div class="ht-countries">${list.map(([iso, items]) => {
    const best = items.slice().sort((a, b) => b.n_waves - a.n_waves)[0];
    const regions = best.n_units == null ? "" : `, ${hvRegionsText(best.n_units)}`;
    return `<a href="${hvHref({ c: iso, t: best.id }, variable)}" title="${esc(hvCountryName(iso))}: ${esc(hvWavesText(best.n_waves))}, ${esc(htYears(items))}${esc(regions)}">${esc(hvCountryName(iso))}</a>`;
  }).join(" ")}</div>`;
}

function htBody() {
  const questions = htQuestions();
  const cons = hvConstructs();
  const axis = hvAxisHtml().axis;
  let nRows = 0, nTl = 0;
  HT.rows = [];
  const tbody = v => {
    const series = questions.get(v.id);
    const rowsTotal = series.reduce((a, s) => a + s.rows.length, 0);
    let firstOfVar = true;
    return `<tbody data-htq="${esc(v.id)}">${series.map(s => s.rows.map((r, k) => {
      const at = HT.rows.push({ variable: v.id, row: r }) - 1;
      nRows++; if (!r.all) nTl += r.items.length;
      const units = r.items.map(i => i.n_units).filter(x => x != null);
      const waves = r.items.map(i => i.n_waves);
      const concept = firstOfVar ? `<th scope="rowgroup" rowspan="${rowsTotal}" class="ht-concept"><label><input type="checkbox" data-htvar="${esc(v.id)}"> <span class="sr-only">Pick every timeline of</span></label> <a href="${hvHref({}, v.id)}">${esc(v.name)}</a>${hvQTypeTag(v)}</th>` : "";
      firstOfVar = false;
      const seriesCell = k === 0 ? `<td rowspan="${s.rows.length}" class="ht-series"><b>${esc(s.head)}</b><br><span class="muted">${esc(s.text)}</span></td>` : "";
      return `<tr class="${r.all ? "ht-all" : ""}">${concept}${seriesCell}
        <td class="ht-level"><label><input type="checkbox" data-htrow="${at}"> ${esc(r.level)}</label>${units.length ? `<br><span class="muted">${htRange(Math.min(...units), Math.max(...units))} regions</span>` : ""}</td>
        <td class="ht-axis">${htStrip(v.id, r)}</td>
        <td class="num">${htRange(Math.min(...waves), Math.max(...waves))}</td><td class="num">${esc(htYears(r.items))}</td>
        <td>${htCountries(v.id, r)}</td></tr>`;
    }).join("")).join("")}</tbody>`;
  };
  const sections = cons.map(c => {
    const vs = hvVars().filter(v => v.construct === c.id && questions.has(v.id)).sort((a, b) => a.name.localeCompare(b.name));
    if (!vs.length) return "";
    return `<details class="card ht-con" data-htcon="${esc(c.id)}"${HT.folded.has(c.id) ? "" : " open"}><summary><b>${esc(c.name)}</b> <span class="hv-tag">${hvQuestionsText(vs.length)}</span></summary>
      <div class="ht-scroll"><table class="occ ht-table"><thead><tr><th>Question</th><th>Series</th><th>Geography</th><th class="ht-axis"><div class="ht-axis-years">${axis}</div></th><th class="num">Waves</th><th class="num">Years</th><th>Countries</th></tr></thead>
      ${vs.map(tbody).join("")}</table></div></details>`;
  }).join("");
  return `<section class="card ht-head"><h3>Timelines: ${esc(hvSelName())}${HV.iso ? `, ${esc(hvCountryName(HV.iso))}` : ""}</h3>
      <p class="muted">${hvQuestionsText(questions.size)}, ${fmt(nTl)} harmonized timelines and every observation of each question, on one axis from ${HV_Y0} to ${HV_Y1}. Within a question, its series and their geographies are sorted from the most detailed to the least. Choose a question, a construct or a country above to narrow the list. Click a country to open its page at that timeline (a timeline itself opens the country with the most waves), and tick rows to download them.</p>
      <div id="htBar">${htBar()}</div></section>
    ${sections || `<p class="muted">No timelines for this selection.</p>`}`;
}

// What is ticked, in the list's order.
function htPickedItems() {
  return [...HT.picked].map(k => { const [variable, country, id] = k.split("|"); return { variable, country, id }; });
}
function htBar() {
  const n = HT.picked.size, m = new Set(htPickedItems().map(i => i.country)).size;
  const much = n > HT_MAX;
  return `<div class="ht-bar">
    <span><b>${n ? `${fmt(n)} ${n === 1 ? "timeline" : "timelines"} in ${m} ${m === 1 ? "country" : "countries"} ticked` : "No timeline ticked"}</b>${much ? ` <span class="err">At most ${HT_MAX} in one download</span>` : HT.message ? ` <span class="muted">${esc(HT.message)}</span>` : ""}</span>
    <label class="field"><span>Separator</span><select id="htSep"><option value=","${HT.sep === "," ? " selected" : ""}>Comma</option><option value=";"${HT.sep === ";" ? " selected" : ""}>Semicolon, for Excel in Europe</option></select></label>
    <button type="button" class="btn primary" id="htDownload"${!n || much || HT.busy ? " disabled" : ""}>${HT.busy ? "Preparing…" : "Download ticked (ZIP)"}</button>
    <button type="button" class="btn" id="htList">Download this list (CSV)</button>
    <button type="button" class="btn" id="htClear"${n ? "" : " disabled"}>Clear</button></div>`;
}

// Ticks follow what is picked: a row is ticked with all its timelines, half with some.
function htMarkTicks() {
  const body = $("#htBody");
  if (!body) return;
  const state = keys => { const on = keys.filter(k => HT.picked.has(k)).length; return on === 0 ? 0 : on === keys.length ? 2 : 1; };
  const set = (el, st) => { el.checked = st === 2; el.indeterminate = st === 1; };
  const rowKeys = r => r.row.items.map(i => htKey(r.variable, i.iso, i.id));
  body.querySelectorAll("[data-htrow]").forEach(el => set(el, state(rowKeys(HT.rows[+el.dataset.htrow]))));
  // A question's tick covers its harmonized timelines; every observation is ticked on its own row.
  body.querySelectorAll("[data-htvar]").forEach(el => {
    const rows = HT.rows.filter(r => r.variable === el.dataset.htvar), own = rows.filter(r => !r.row.all);
    set(el, state((own.length ? own : rows).flatMap(rowKeys)));
  });
  $("#htBar").innerHTML = htBar();
}
function htToggle(keys, on) {
  for (const k of keys) if (on) HT.picked.add(k); else HT.picked.delete(k);
  HT.message = "";
  htMarkTicks();
}

function htOnChange(el) {
  if (el.dataset && el.dataset.htrow != null) {
    const r = HT.rows[+el.dataset.htrow];
    htToggle(r.row.items.map(i => htKey(r.variable, i.iso, i.id)), el.checked);
    return true;
  }
  if (el.dataset && el.dataset.htvar) {
    const rows = HT.rows.filter(r => r.variable === el.dataset.htvar), own = rows.filter(r => !r.row.all);
    htToggle((own.length ? own : rows).flatMap(r => r.row.items.map(i => htKey(r.variable, i.iso, i.id))), el.checked);
    return true;
  }
  if (el.id === "htSep") { HT.sep = el.value; return true; }
  return false;
}
function htOnToggle(el) {
  const c = el.dataset && el.dataset.htcon;
  if (c) (el.open ? HT.folded.delete(c) : HT.folded.add(c));
}
function htOnClick(target) {
  if (target.closest("#htClear")) { HT.picked.clear(); HT.message = ""; htMarkTicks(); return true; }
  if (target.closest("#htList")) { htSave(`harmonized_timelines_${hxToday()}.csv`, new Blob(["﻿" + hxCsv(htListTable(), HT.sep)], { type: "text/csv;charset=utf-8" })); return true; }
  if (target.closest("#htDownload")) { htDownload(); return true; }
  return false;
}

function htSave(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
// The list on screen as a table: one row per timeline and country.
function htListTable() {
  const names = new Map(hvVars().map(v => [v.id, v])), cons = new Map(hvConstructs().map(c => [c.id, c.name]));
  const rows = HT.rows.flatMap(({ variable, row }) => row.items.map(i => {
    const v = names.get(variable);
    return { construct: cons.get(v.construct), variable_id: variable, question: v.name, country: i.iso, country_name: hvCountryName(i.iso), timeline_id: i.id, geography: row.level,
      regions: i.n_units, waves: i.n_waves, first_year: String(i.start).slice(0, 4), last_year: String(i.end).slice(0, 4),
      wave_dates: i.dates.join(";"), programs: i.t ? [...new Set(hvList(i.t.waves).map(hvProgramOf))].join(";") : [...new Set(htObs(variable, i.iso).map(o => hvProgramOf(o.wave)))].join(";"),
      questions: i.t ? hvList(i.t.instruments).join(";") : null };
  }));
  return { name: "timelines.csv", columns: Object.keys(rows[0] || { timeline_id: 0 }), rows };
}
async function htDownload() {
  HT.busy = true; HT.message = "Loading the data of the ticked timelines";
  htMarkTicks();
  try {
    const built = await hxBuildExport(htPickedItems(), HV.index, hvFile, hxToday());
    const zip = await hxZip(hxFiles(built, HT.sep));
    const place = built.countries.length <= 3 ? built.countries.join("_") : `${built.countries.length}_countries`;
    htSave(`harmonized_timelines_${place}_${hxToday()}.zip`, new Blob([zip], { type: "application/zip" }));
    HT.message = "Downloaded";
  } catch (e) {
    console.error(e);
    HT.message = `Could not build the download (${e.message})`;
  }
  HT.busy = false;
  htMarkTicks();
}
