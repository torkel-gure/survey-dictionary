"use strict";
/* Export of harmonized data, chosen on the Harmonized variables tab.
   Pick variables, countries and timelines; the browser builds a ZIP with the regional counts per wave, each respondent's
   file, row, coded answer and region, one item and answer mapping, and one region mapping per country.
   Nothing else from the source files is on the site: the file and row lead back to them.
   The builders (hxBuildExport, hxCsv, hxZip) do not touch the page. */

const HX_CATS = ["pro", "anti", "mid", "dk", "refused", "nonresp", "not_asked", "other_missing"];
const HX_CAT_LABELS = { pro: "Protectionist", anti: "Not protectionist", mid: "Middle category", dk: "Don't know", refused: "Refused", nonresp: "Nonresponse (don't know and refused together)", not_asked: "Not asked", other_missing: "Other missing" };
const hxList = x => x == null ? [] : [].concat(x);
const hxLevelName = t => t.level ? t.level_label : "Finest in each wave";
const hxSegment = id => id.replace(/-(bin|orig)-/, "-");

/* ---------- the tables ---------- */
const hxDist = x => { if (!x) return {}; try { return JSON.parse(x); } catch (e) { return {}; } };

// One row per timeline x wave x region, holding both the 1-or-0 share and the original scale.
function hxDataTable(items) {
  const rows = [];
  const origKeys = new Set();
  for (const it of items) {
    const { t, d, e, name } = it;
    const waves = new Map(hxList(d.waves).map(w => [w.wave_key, w]));
    const names = new Map(hxList(d.units).map(u => [u.id, u.name]));
    const changes = new Map(hxList(t.changes).map(c => [c.wave, hxList(c.kinds).join(";")]));
    const order = new Map(hxList(t.waves).map((k, i) => [k, i]));
    const merged = new Map();
    for (const r of hxList(e.estimates)) {
      if (hxSegment(r.segment_id) !== t.id || !order.has(r.wave_key)) continue;
      const key = r.wave_key + "|" + (r.unit_id || "");
      if (!merged.has(key)) merged.set(key, { ...r });
      const m = merged.get(key);
      for (const f of ["p_bin", "se_bin", "dist_orig", "dist_all", "source_id", "instrument_id", "flags"]) if (m[f] == null && r[f] != null) m[f] = r[f];
      m[/-bin-/.test(r.segment_id) ? "n_bin" : "n_orig"] = r.n_substantive;
    }
    const here = [...merged.values()].sort((a, b) => order.get(a.wave_key) - order.get(b.wave_key) || String(a.unit_id || "~").localeCompare(String(b.unit_id || "~")));
    for (const r of here) {
      const w = waves.get(r.wave_key) || {};
      const all = hxDist(r.dist_all), orig = hxDist(r.dist_orig);
      const row = {
        timeline_id: t.id, variable_id: it.variable, variable: name, country: it.country, geography: hxLevelName(t),
        program: w.program, wave: w.wave, wave_key: r.wave_key, study: w.study, question: r.instrument_id || w.instrument, file: w.file, file_variable: w.variable,
        reference_date: r.reference_date, fieldwork_start: w.date_min, fieldwork_end: w.date_max,
        unit_id: r.unit_id, unit_name: r.unit_id ? (names.get(r.unit_id) || r.unit_id) : "Not coded",
        n_total: r.n_total, n_asked: r.n_asked, n_bin: r.n_bin, n_orig: r.n_orig, p_bin: r.p_bin, se_bin: r.se_bin,
      };
      for (const c of HX_CATS) row[`n_${c}`] = all[c] || 0;
      for (const k of Object.keys(orig)) { origKeys.add(k); row[`orig_${k}`] = orig[k]; }
      row.changes_at_wave = changes.get(r.wave_key);
      row.source_id = r.source_id;
      row.flags = r.flags;
      rows.push(row);
    }
  }
  const orig = [...origKeys].sort((a, b) => Number(a) - Number(b)).map(k => `orig_${k}`);
  for (const r of rows) for (const c of orig) if (r[c] == null && r.n_total) r[c] = 0;
  return {
    name: "data.csv",
    what: "Regional counts per wave, for each timeline you picked",
    columns: ["timeline_id", "variable_id", "variable", "country", "geography", "program", "wave", "wave_key", "study", "question", "file", "file_variable",
      "reference_date", "fieldwork_start", "fieldwork_end", "unit_id", "unit_name", "n_total", "n_asked", "n_bin", "n_orig", "p_bin", "se_bin",
      ...HX_CATS.map(c => `n_${c}`), ...orig, "changes_at_wave", "source_id", "flags"],
    rows,
  };
}

// One row per answer of every question in the export, with the countries that use it.
function hxMappingTable(items) {
  const rows = new Map();
  const seen = new Set();
  for (const it of items) {
    const { t, d, name } = it;
    const waves = new Map(hxList(d.waves).map(w => [w.wave_key, w]));
    for (const key of hxList(t.waves)) {
      const once = `${it.variable}|${it.country}|${key}`;
      if (seen.has(once)) continue; // two timelines of a country can share a wave
      seen.add(once);
      const w = waves.get(key) || {};
      for (const a of hxList(d.answers)) {
        if (a.wave !== key) continue;
        const id = [it.variable, key, w.instrument, w.file, a.var, a.code, a.label, a.coded, a.bin, a.orig, a.rule].join("|");
        if (!rows.has(id)) rows.set(id, {
          variable_id: it.variable, variable: name, question: w.instrument, program: w.program, wave: w.wave, wave_key: key, date: w.date, study: w.study, file: w.file,
          file_variable: a.var, file_variable_label: w.variable_label, question_id: w.question_id, item_no: w.item_no, page: w.page, questionnaire_url: w.questionnaire_url,
          wording: w.wording, answers_offered: w.scale, how_asked: w.presentation, dont_know: w.dk_presentation, interview_mode: w.mode, definitions: w.definition,
          code: a.code, label_in_file: a.label, coded_as: a.coded, coded_as_label: HX_CAT_LABELS[a.coded] || a.coded, bin: a.bin, orig: a.orig, rule: a.rule, why: a.why, status: a.status,
          _countries: new Set(), respondents: 0,
        });
        const r = rows.get(id);
        r._countries.add(it.country);
        r.respondents += a.n || 0;
      }
    }
  }
  const out = [...rows.values()].map(r => ({ ...r, countries: [...r._countries].sort().join(";") }));
  const varOrder = [...new Set(items.map(i => i.variable))];
  out.sort((a, b) => varOrder.indexOf(a.variable_id) - varOrder.indexOf(b.variable_id) || String(a.date).localeCompare(String(b.date)) || String(a.file_variable).localeCompare(String(b.file_variable)));
  return {
    name: "item_answer_mapping.csv",
    what: "Every question in this export and what each answer was coded to, with the countries using it",
    columns: ["variable_id", "variable", "question", "program", "wave", "wave_key", "date", "study", "file", "file_variable", "file_variable_label", "question_id", "item_no", "page",
      "questionnaire_url", "wording", "answers_offered", "how_asked", "dont_know", "interview_mode", "definitions", "code", "label_in_file", "coded_as", "coded_as_label", "bin", "orig", "rule", "why", "status", "countries", "respondents"],
    rows: out,
  };
}

// One file per country: every region code in the waves of its picked timelines, and the region it counts as.
function hxRegionTable(country, items) {
  const levels = new Map();
  const rows = new Map();
  for (const it of items) if (it.t.level) levels.set(it.t.level, it.t.level_label);
  const levelIds = [...levels.keys()].sort();
  for (const it of items) {
    const { t, d } = it;
    const names = new Map(hxList(d.units).map(u => [u.id, u.name]));
    const maps = new Map(hxList(d.levels).map(l => [l.id, new Map(hxList(l.members).map(m => [m.fine, m.unit]))]));
    const waveKeys = new Set(hxList(t.waves));
    const waves = new Map(hxList(d.waves).map(w => [w.wave_key, w]));
    const sourceWave = new Map(hxList(d.cells).map(c => [c.source, c.wave]));
    for (const c of hxList(d.coding)) {
      const key = sourceWave.get(c.source);
      if (!key || !waveKeys.has(key)) continue;
      const id = `${c.source}|${c.var}|${c.code}`;
      if (rows.has(id)) continue;
      const w = waves.get(key) || {};
      const row = {
        country, program: w.program, wave: w.wave, wave_key: key, date: w.date, source_id: c.source, subsample: c.subsample, region_variable: c.var, region_variable_label: c.var_label,
        used_in_data: c.used ? "yes" : "no", code: c.code, label_in_file: c.label, respondents_in_source: c.n, unit_id: c.unit, unit_name: c.unit_name, assignment: c.assignment, rule: c.rule, why: c.rationale,
      };
      for (const l of levelIds) {
        const u = c.unit ? (maps.get(l) || new Map()).get(c.unit) : null;
        row[`unit_${l}`] = u;
        row[`unit_${l}_name`] = u ? (names.get(u) || u) : null;
      }
      rows.set(id, row);
    }
  }
  const out = [...rows.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.source_id).localeCompare(String(b.source_id)) ||
    (a.used_in_data === b.used_in_data ? 0 : a.used_in_data === "yes" ? -1 : 1) || String(a.region_variable).localeCompare(String(b.region_variable)));
  return {
    name: `region_mapping_${country}.csv`,
    what: `How each region code in ${country} was coded`,
    columns: ["country", "program", "wave", "wave_key", "date", "source_id", "subsample", "region_variable", "region_variable_label", "used_in_data", "code", "label_in_file", "respondents_in_source",
      "unit_id", "unit_name", ...levelIds.flatMap(l => [`unit_${l}`, `unit_${l}_name`]), "assignment", "rule", "why"],
    rows: out,
  };
}

// One row per respondent x timeline. Built only when written: a large selection holds many rows.
function hxRespondentTable(items) {
  const parts = [];
  for (const it of items) {
    const order = new Map(hxList(it.t.waves).map((k, i) => [k, i]));
    const level = it.t.level ? new Map(hxList((hxList(it.d.levels).find(l => l.id === it.t.level) || {}).members).map(m => [m.fine, m.unit])) : null;
    const mine = hxList(it.r.blocks).filter(b => order.has(b.wave)).sort((a, b) => order.get(a.wave) - order.get(b.wave) || String(a.source).localeCompare(String(b.source)));
    for (const b of mine) parts.push({ it, b, level });
  }
  function* each() {
    for (const { it, b, level } of parts) {
      const row = hxList(b.row), unit = hxList(b.unit), harm = hxList(b.harm), bin = hxList(b.bin), orig = hxList(b.orig);
      for (let i = 0; i < row.length; i++) {
        const fine = unit[i] == null ? null : unit[i];
        yield {
          timeline_id: it.t.id, variable_id: it.variable, country: it.country, geography: hxLevelName(it.t), wave_key: b.wave, question: b.question, file: b.file, file_variable: b.var, row: row[i],
          unit_id: level ? (fine ? level.get(fine) : null) : fine, unit_fine: fine, harm_cat: harm[i], bin: bin[i], orig: orig[i],
        };
      }
    }
  }
  const preview = [];
  for (const r of each()) { preview.push(r); if (preview.length === 12) break; }
  return {
    name: "respondents.csv",
    what: "Each respondent's file, row, region and coded answer, for each timeline you picked",
    columns: ["timeline_id", "variable_id", "country", "geography", "wave_key", "question", "file", "file_variable", "row", "unit_id", "unit_fine", "harm_cat", "bin", "orig"],
    count: parts.reduce((a, p) => a + hxList(p.b.row).length, 0),
    rows: preview,
    each,
  };
}

// The exact source files: a row number holds only for this release of the file.
function hxFilesTable(items) {
  const rows = new Map();
  for (const it of items) {
    const used = new Set(hxList(it.d.waves).filter(w => hxList(it.t.waves).includes(w.wave_key)).map(w => w.file));
    for (const f of hxList(it.d.files)) if (used.has(f.file)) rows.set(f.file, f);
  }
  return {
    name: "files.csv", what: "The exact source files, with their checksums", columns: ["file", "sha256", "n_rows", "bytes"],
    rows: [...rows.values()].sort((a, b) => String(a.file).localeCompare(String(b.file))),
  };
}

function hxTimelineTable(items) {
  const rows = items.map(it => {
    const t = it.t;
    return {
      timeline_id: t.id, variable_id: it.variable, variable: it.name, country: it.country, geography: hxLevelName(t), regions: t.n_units, waves: t.n_waves,
      first_wave: t.start, last_wave: t.end, span_years: t.span_years, longest_gap_years: t.max_gap_years, tier: t.tier,
      questions: hxList(t.instruments).join(";"), wave_keys: hxList(t.waves).join(";"), forms: hxList(t.forms).join(";"),
    };
  });
  return { name: "timelines.csv", what: "The timelines you picked", columns: Object.keys(rows[0] || { timeline_id: 0 }), rows };
}

function hxSelection(items, created) {
  return {
    format: "harmonized-export-selection", version: 1, created,
    timelines: items.map(it => ({ id: it.t.id, variable: it.variable, country: it.country, scheme: it.t.scheme, level: it.t.level || null, waves: hxList(it.t.waves) })),
  };
}

function hxReadme(items, tables, created) {
  const countries = [...new Set(items.map(i => i.country))].sort();
  return `Harmonized data export, ${created}

Timelines: ${items.length}. Countries: ${countries.join(", ")}.
Counts are unweighted.

FILES
${tables.map(t => `${t.name}: ${t.what}. ${t.count == null ? t.rows.length : t.count} rows.`).join("\n")}
selection.json: what you picked.

data.csv
One row per timeline x wave x region.
- timeline_id, geography: the timeline, and the level of geography it counts regions at.
- question: the harmonized question in that wave. file and file_variable: where it sits in the source data.
- reference_date, fieldwork_start, fieldwork_end: the date used for the wave, and its fieldwork.
- unit_id, unit_name: the region. "Not coded" holds respondents whose region code could not be assigned.
- n_total: respondents in the region and wave. n_asked: those asked the question. n_bin: those coded 1 or 0. n_orig: those on the original scale.
- p_bin: share coded 1 (protectionist) among n_bin. se_bin: sqrt(p(1-p)/(n_bin-1)).
- n_pro ... n_other_missing: respondents in each harmonized category. Don't know, refused and not asked stay apart.
- orig_1, orig_2, ...: respondents at each value of the original scale. See the orig column of the mapping.
- changes_at_wave: what changes about the question or coding at this wave.
- flags: not_covered (the wave does not reach this region), unassignable, pooled_subsamples.

item_answer_mapping.csv
One row per answer, per question, per wave. It appears once per export and covers every question in it.
- wording, answers_offered, how_asked, dont_know, interview_mode, definitions: the question as the questionnaire has it. questionnaire_url links to it.
- code, label_in_file: the answer in the source file.
- coded_as, bin, orig: what it was coded to. rule and why: the coding rule behind it. status: approved or proposed.
- countries: which countries in this export use this row. respondents: how many, across them.

region_mapping_<country>.csv
One file per country. One row per region code in each source, in the waves of the picked timelines.
- region_variable, code, label_in_file: the code as it stands in the source file. used_in_data: whether this variable is the one respondents were coded by.
- unit_id, unit_name: the finest region it was coded to. unit_<level>: the region it counts as at that level. Blank unit_id: it could not be coded.
- assignment, rule, why: how the assignment was made.

respondents.csv
One row per respondent x timeline. Summing it by timeline, wave and region gives data.csv.
- file, row: where the respondent sits in the source file. row counts data rows from 1, in the order of the file. It holds only for the exact release listed in files.csv.
- question, file_variable: the question, and its variable in that file.
- unit_id: the region at this timeline's level. unit_fine: the finest region the respondent was coded to. Empty: the region code could not be assigned.
- harm_cat, bin, orig: the coded answer. See item_answer_mapping.csv for what each answer was coded to.
Nothing else from the source files is here. Interview dates and all other variables are in the source files, and file and row lead to them.

files.csv
- file, sha256, n_rows, bytes: check your copy against these before using row numbers.

Inside the harmonization project, this builds the same selection with interview dates, as .rds and .dta:
Rscript -e "targets::tar_source('R'); deliver_selection('selection.json')"
`;
}

/* ---------- writing ---------- */
function hxCsv(table, sep = ",") {
  const excel = sep === ";"; // for Excel in a European locale: decimal commas, and a BOM so it reads the text as UTF-8
  const cell = v => {
    if (v == null) return "";
    let s = typeof v === "number" && excel ? String(v).replace(".", ",") : String(v);
    if (s.includes(sep) || /["\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [table.columns.map(cell).join(sep)];
  for (const r of table.each ? table.each() : table.rows) lines.push(table.columns.map(c => cell(r[c])).join(sep));
  return (excel ? "\ufeff" : "") + lines.join("\n") + "\n";
}

const hxDeflate = async bytes => {
  if (typeof CompressionStream === "undefined") return null;
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
};

// A small ZIP writer, so the page needs no outside library. Files are compressed where the browser can.
async function hxZip(files, when = new Date()) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const enc = new TextEncoder();
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const parts = [], central = [];
  let offset = 0;
  const header = (size, fill) => { const b = new Uint8Array(size); fill(new DataView(b.buffer)); return b; };
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data), at = offset;
    const packed = await hxDeflate(data);
    const method = packed && packed.length < data.length ? 8 : 0;
    const body = method ? packed : data;
    const local = header(30, v => {
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, method, true); v.setUint16(10, time, true); v.setUint16(12, date, true);
      v.setUint32(14, crc, true); v.setUint32(18, body.length, true); v.setUint32(22, data.length, true); v.setUint16(26, name.length, true); v.setUint16(28, 0, true);
    });
    parts.push(local, name, body);
    offset += local.length + name.length + body.length;
    central.push(header(46, v => {
      v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true); v.setUint16(10, method, true); v.setUint16(12, time, true); v.setUint16(14, date, true);
      v.setUint32(16, crc, true); v.setUint32(20, body.length, true); v.setUint32(24, data.length, true); v.setUint16(28, name.length, true); v.setUint32(42, at, true);
    }), name);
  }
  const dirSize = central.reduce((a, b) => a + b.length, 0);
  const end = header(22, v => {
    v.setUint32(0, 0x06054b50, true); v.setUint16(8, files.length, true); v.setUint16(10, files.length, true); v.setUint32(12, dirSize, true); v.setUint32(16, offset, true);
  });
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const b of all) { out.set(b, p); p += b.length; }
  return out;
}

/* Picked timelines to tables. picked: [{ variable, country, id }]; load(name) returns a parsed JSON file. */
async function hxBuildExport(picked, index, load, created) {
  const names = new Map(hxList(index.variables).map(v => [v.id, v.name]));
  const items = await Promise.all(picked.map(async p => {
    const [d, e, r] = await Promise.all([load(`${p.variable}_${p.country}`), load(`estimates/${p.variable}_${p.country}`), load(`rows/${p.variable}_${p.country}`)]);
    const t = hxList(d.timelines).find(x => x.id === p.id);
    if (!t) throw new Error(`Timeline not found: ${p.id}`);
    return { ...p, name: names.get(p.variable) || p.variable, d, e, r, t };
  }));
  const countries = [...new Set(items.map(i => i.country))].sort();
  const tables = [
    hxDataTable(items),
    hxRespondentTable(items),
    hxMappingTable(items),
    ...countries.map(c => hxRegionTable(c, items.filter(i => i.country === c))),
    hxFilesTable(items),
    hxTimelineTable(items),
  ];
  return { tables, readme: hxReadme(items, tables, created), selection: hxSelection(items, created), countries };
}

function hxFiles(built, sep) {
  return [
    { name: "README.txt", text: built.readme },
    ...built.tables.map(t => ({ name: t.name, text: hxCsv(t, sep) })),
    { name: "selection.json", text: JSON.stringify(built.selection, null, 2) + "\n" },
  ];
}

/* ---------- the page ---------- */
const HX = { vars: new Set(), isos: new Set(), picked: new Set(), filled: new Set(), opened: new Set(), closed: new Set(), sep: ",", view: "data.csv", built: null, token: 0, error: null };

const hxKey = (variable, country, id) => `${variable}|${country}|${id}`;
const hxHas = (variable, iso) => hvList(HV.index.country_totals).some(t => t.variable === variable && t.iso3 === iso);
const hxPairs = () => [...HX.vars].flatMap(v => [...HX.isos].filter(i => hxHas(v, i)).map(i => [v, i]));
const hxToday = () => new Date().toISOString().slice(0, 10);
const hxLongest = list => list.slice().sort((a, b) => b.n_waves - a.n_waves || (b.level ? 1 : 0) - (a.level ? 1 : 0) || b.n_units - a.n_units)[0];

const hxTimelinesOf = async (variable, iso) => hvList((await hvFile(`${variable}_${iso}`)).timelines);

// A variable and country start with the longest timeline ticked, once: what is unticked after that stays unticked.
async function hxFillDefaults() {
  for (const [v, i] of hxPairs()) {
    if (HX.filled.has(`${v}|${i}`)) continue;
    HX.filled.add(`${v}|${i}`);
    const list = await hxTimelinesOf(v, i);
    if (!list.some(t => HX.picked.has(hxKey(v, i, t.id)))) {
      const t = hxLongest(list);
      if (t) HX.picked.add(hxKey(v, i, t.id));
    }
  }
}

async function hxEnter(iso, timeline, region) {
  if (HV.varId) HX.vars.add(HV.varId);
  const totals = hvList(HV.index.country_totals).filter(t => t.variable === HV.varId);
  if (iso && totals.some(t => t.iso3 === iso)) HX.isos.add(iso);
  if (region) for (const t of totals) if (hvCountryRegion(t.iso3) === region) HX.isos.add(t.iso3);
  if (iso && timeline) {
    const list = await hxTimelinesOf(HV.varId, iso);
    if (list.some(t => t.id === timeline)) HX.picked.add(hxKey(HV.varId, iso, timeline));
  }
  await hxFillDefaults();
}

// What is ticked and still in scope, in a stable order.
async function hxPickedNow() {
  const out = [];
  for (const [v, i] of hxPairs()) {
    for (const t of await hxTimelinesOf(v, i)) if (HX.picked.has(hxKey(v, i, t.id))) out.push({ variable: v, country: i, id: t.id });
  }
  return out;
}

function hxBody() {
  const vars = hvList(HV.index.variables);
  const totals = hvList(HV.index.country_totals);
  const respondents = iso => Math.max(0, ...totals.filter(t => t.iso3 === iso && HX.vars.has(t.variable)).map(t => t.n));
  const withData = [...new Set(totals.filter(t => HX.vars.has(t.variable)).map(t => t.iso3))];
  const regions = [...new Set(withData.map(hvCountryRegion))].sort((a, b) => String(a).localeCompare(String(b)));
  const country = iso => `<label class="hx-check"><input type="checkbox" data-hxiso="${esc(iso)}"${HX.isos.has(iso) ? " checked" : ""}> ${esc(hvCountryName(iso))} <span class="muted">${fmt(respondents(iso))}</span></label>`;
  return `<section class="card hx-step"><h3>1. Variables</h3>
      <div class="hx-checks">${vars.map(v => `<label class="hx-check"><input type="checkbox" data-hxvar="${esc(v.id)}"${HX.vars.has(v.id) ? " checked" : ""}> ${esc(v.name)}</label>`).join("")}</div>
    </section>
    <section class="card hx-step"><div class="hx-head"><h3>2. Countries</h3><span class="hx-actions"><button type="button" class="btn small" data-hxdo="all-countries">All</button> <button type="button" class="btn small" data-hxdo="no-countries">None</button></span></div>
      <p class="muted">Countries with data for the variables above, with their respondents.</p>
      ${withData.length ? regions.map(r => `<h4>${esc(r)}</h4><div class="hx-checks">${withData.filter(i => hvCountryRegion(i) === r).sort((a, b) => hvCountryName(a).localeCompare(hvCountryName(b))).map(country).join("")}</div>`).join("") : `<p class="muted">Choose a variable first.</p>`}
    </section>
    <section class="card hx-step" id="hxTimelines"><h3>3. Timelines</h3><p class="muted">Loading…</p></section>
    <section class="card hx-step" id="hxOut"><h3>4. Your export</h3><p class="muted">Choose at least one timeline.</p></section>`;
}

async function hxTimelinesHtml() {
  const pairs = hxPairs();
  if (!pairs.length) return `<h3>3. Timelines</h3><p class="muted">Choose a variable and a country first.</p>`;
  const lists = new Map();
  for (const [v, i] of pairs) lists.set(`${v}|${i}`, await hxTimelinesOf(v, i));
  const names = new Map(hvList(HV.index.variables).map(v => [v.id, v.name]));
  const levels = new Map();
  for (const l of lists.values()) for (const t of l) if (t.level) levels.set(t.level, t.level_label);
  const programs = t => [...new Set(hvList(t.waves).map(k => k.split(":")[0]))].join(" and ");
  const sorted = l => l.slice().sort((a, b) => hvList(b.instruments).length - hvList(a.instruments).length || String(a.start).localeCompare(String(b.start)) || (b.level ? 1 : 0) - (a.level ? 1 : 0) || b.n_units - a.n_units);
  const row = (v, i, t) => `<tr><td><input type="checkbox" id="hx-${esc(hxKey(v, i, t.id))}" data-hxtl="${esc(hxKey(v, i, t.id))}"${HX.picked.has(hxKey(v, i, t.id)) ? " checked" : ""}></td>
    <td><label for="hx-${esc(hxKey(v, i, t.id))}">${esc(programs(t))}</label></td><td>${t.level ? `${t.n_units} regions, ${esc(t.level_label)}` : `Finest in each wave, ${t.n_units} regions`}</td><td class="num">${t.n_waves}</td><td>${esc(hvTlYears(t))}</td></tr>`;
  const countries = [...new Set(pairs.map(p => p[1]))].sort((a, b) => hvCountryName(a).localeCompare(hvCountryName(b)));
  const block = iso => {
    const here = pairs.filter(p => p[1] === iso);
    const n = here.reduce((a, [v]) => a + lists.get(`${v}|${iso}`).filter(t => HX.picked.has(hxKey(v, iso, t.id))).length, 0);
    const total = here.reduce((a, [v]) => a + lists.get(`${v}|${iso}`).length, 0);
    const open = HX.closed.has(iso) ? false : HX.opened.has(iso) || countries.length <= 5;
    return `<details class="hx-country" data-hxblock="${esc(iso)}"${open ? " open" : ""}><summary><b>${esc(hvCountryName(iso))}</b> <span class="muted">${n} of ${total} timelines picked</span></summary>
      ${here.map(([v]) => `<h4>${esc(names.get(v))}</h4><div class="hv-scroll"><table class="occ"><thead><tr><th></th><th>Programs</th><th>Regions</th><th class="num">Waves</th><th>Years</th></tr></thead>
        <tbody>${sorted(lists.get(`${v}|${iso}`)).map(t => row(v, iso, t)).join("")}</tbody></table></div>`).join("")}</details>`;
  };
  return `<h3>3. Timelines</h3>
    <p class="muted">Each country starts with its longest timeline. Tick any others you want, or set all countries at once.</p>
    <div class="hx-actions"><button type="button" class="btn small" data-hxdo="longest">Longest in each country</button>
      ${[...levels.entries()].sort().map(([id, label]) => `<button type="button" class="btn small" data-hxdo="level:${esc(id)}">All at ${esc(label)}</button>`).join(" ")}
      <button type="button" class="btn small" data-hxdo="every">Every timeline</button> <button type="button" class="btn small" data-hxdo="clear">Clear</button></div>
    ${countries.map(block).join("")}`;
}

function hxOutHtml() {
  const b = HX.built;
  if (HX.error) return `<h3>4. Your export</h3><p class="err">Could not build the export (${esc(HX.error)}).</p>`;
  if (!b) return `<h3>4. Your export</h3><p class="muted">Choose at least one timeline.</p>`;
  const view = b.tables.find(t => t.name === HX.view) || b.tables[0];
  const shown = view.rows.slice(0, 12);
  const n = b.selection.timelines.length;
  return `<h3>4. Your export</h3>
    <p>${n} ${n === 1 ? "timeline" : "timelines"} in ${b.countries.length} ${b.countries.length === 1 ? "country" : "countries"}. Counts are unweighted.</p>
    <div class="hv-scroll"><table class="occ hx-files"><thead><tr><th>File</th><th>What it holds</th><th class="num">Rows</th><th>Preview</th></tr></thead>
      <tbody>${b.tables.map(t => `<tr${t.name === view.name ? ` class="on"` : ""}><td><code>${esc(t.name)}</code></td><td>${esc(t.what)}</td><td class="num">${fmt(t.count == null ? t.rows.length : t.count)}</td><td><button type="button" class="btn small" data-hxview="${esc(t.name)}"${t.name === view.name ? ` aria-pressed="true"` : ""}>Show</button></td></tr>`).join("")}</tbody></table></div>
    <div class="hx-download">
      <label class="field"><span>Separator</span><select id="hxSep"><option value=","${HX.sep === "," ? " selected" : ""}>Comma</option><option value=";"${HX.sep === ";" ? " selected" : ""}>Semicolon, for Excel in Europe</option></select></label>
      <button type="button" class="btn primary" id="hxDownload">Download ZIP</button>
    </div>
    <p class="muted">The ZIP also holds a README explaining every column. Respondents come with their file and row, coded answer and region, and nothing else from the source files.</p>
    <h4><code>${esc(view.name)}</code>: first ${shown.length} of ${fmt(view.count == null ? view.rows.length : view.count)} rows</h4>
    <div class="hv-scroll hx-preview"><table class="occ"><thead><tr>${view.columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${shown.map(r => `<tr>${view.columns.map(c => `<td>${r[c] == null ? "" : esc(String(r[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

// Redraws what depends on the selection; a later change overrides an earlier one still loading.
async function hxRefresh(refocus) {
  const token = ++HX.token;
  const timelines = $("#hxTimelines"), out = $("#hxOut");
  if (!timelines || !out) return;
  try {
    await hxFillDefaults();
    const html = await hxTimelinesHtml();
    if (token !== HX.token) return;
    timelines.innerHTML = html;
    const picked = await hxPickedNow();
    HX.error = null;
    HX.built = picked.length ? await hxBuildExport(picked, HV.index, hvFile, hxToday()) : null;
  } catch (e) {
    console.error(e);
    HX.error = e.message;
    HX.built = null;
  }
  if (token !== HX.token) return;
  out.innerHTML = hxOutHtml();
  if (refocus) { const el = $("#hxBody").querySelector(refocus); if (el) el.focus({ preventScroll: true }); }
}

function hxRedraw(refocus) {
  $("#hxBody").innerHTML = hxBody();
  hxRefresh(refocus);
}

async function hxDownload(button) {
  const b = HX.built;
  if (!b) return;
  button.disabled = true;
  button.textContent = "Preparing…";
  await new Promise(r => setTimeout(r, 30)); // lets the button update before the work starts
  let zip;
  try {
    zip = await hxZip(hxFiles(b, HX.sep));
  } catch (e) {
    console.error(e);
    button.textContent = "Could not build the ZIP";
    return;
  }
  button.disabled = false;
  button.textContent = "Download ZIP";
  const place = b.countries.length <= 3 ? b.countries.join("_") : `${b.countries.length}_countries`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  a.download = `harmonized_export_${place}_${hxToday()}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function hxOnChange(el) {
  if (el.dataset.hxvar) {
    if (el.checked) HX.vars.add(el.dataset.hxvar); else HX.vars.delete(el.dataset.hxvar);
    hxRedraw(`[data-hxvar="${CSS.escape(el.dataset.hxvar)}"]`);
    return true;
  }
  if (el.dataset.hxiso) {
    if (el.checked) HX.isos.add(el.dataset.hxiso); else HX.isos.delete(el.dataset.hxiso);
    hxRefresh(`[data-hxiso="${CSS.escape(el.dataset.hxiso)}"]`);
    return true;
  }
  if (el.dataset.hxtl) {
    if (el.checked) HX.picked.add(el.dataset.hxtl); else HX.picked.delete(el.dataset.hxtl);
    hxRefresh(`[data-hxtl="${CSS.escape(el.dataset.hxtl)}"]`);
    return true;
  }
  if (el.id === "hxSep") { HX.sep = el.value; return true; }
  return false;
}

async function hxOnClick(target) {
  const view = target.closest("[data-hxview]");
  if (view) { HX.view = view.dataset.hxview; $("#hxOut").innerHTML = hxOutHtml(); return true; }
  if (target.closest("#hxDownload")) { hxDownload(target.closest("#hxDownload")); return true; }
  const act = target.closest("[data-hxdo]");
  if (!act) return false;
  const what = act.dataset.hxdo;
  if (what === "all-countries") { for (const t of hvList(HV.index.country_totals)) if (HX.vars.has(t.variable)) HX.isos.add(t.iso3); hxRedraw(); return true; }
  if (what === "no-countries") { HX.isos.clear(); hxRedraw(); return true; }
  const pairs = hxPairs();
  for (const [v, i] of pairs) for (const t of await hxTimelinesOf(v, i)) HX.picked.delete(hxKey(v, i, t.id));
  if (what !== "clear") {
    for (const [v, i] of pairs) {
      const list = await hxTimelinesOf(v, i);
      const pick = what === "every" ? list : what === "longest" ? [hxLongest(list)] : list.filter(t => `level:${t.level}` === what);
      for (const t of pick) if (t) HX.picked.add(hxKey(v, i, t.id));
    }
  }
  hxRefresh(`[data-hxdo="${CSS.escape(what)}"]`);
  return true;
}
