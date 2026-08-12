/**
 * Prove that importing an unchanged workbook writes nothing.
 *
 *   npm run test-import
 *
 * Runs the real import twice, over the real workbook, through the same
 * lib/import/plan.ts the importer uses. Only the store is swapped: a Map here,
 * Supabase there. So this exercises the decision that matters — did this sheet
 * change? — without a database.
 *
 * It exists because that decision was wrong once. The importer compared a
 * stored content hash, and when the hash function itself changed, every stored
 * hash silently stopped matching and nine sheets re-versioned of which six were
 * untouched. A test that imports the same file twice would have caught it the
 * moment the formula moved.
 */

import { readFileSync } from "node:fs";

import * as XLSX from "xlsx";

import { contentHash, importSheet, sameContent } from "../lib/import/plan.ts";

const WORKBOOK = "data/Amzai_Dedicated_Team_Onboarding-5.xlsx";

const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass, detail });

/* -------------------------------------------------------------------------- */
/* A store held in memory, with the same shape the database has                */
/* -------------------------------------------------------------------------- */

function makeStore() {
  const templates = [];
  const fields = new Map(); // template id -> rows
  let next = 0;
  const writes = { templates: 0, fields: 0, owners: 0 };

  return {
    writes,
    all: () => templates.map((t) => ({ ...t, fields: fields.get(t.id) ?? [] })),

    async latestBySlug(slug) {
      const found = templates
        .filter((t) => t.slug === slug)
        .sort((a, b) => b.version - a.version)[0];
      return found ? { ...found, fields: fields.get(found.id) ?? [] } : null;
    },

    async createTemplate(input) {
      const id = `t${(next += 1)}`;
      templates.push({ id, ...input });
      fields.set(id, []);
      writes.templates += 1;
      return { id };
    },

    async insertFields(templateId, rows) {
      fields.set(
        templateId,
        rows.map((f, index) => ({
          id: `${templateId}-f${index}`,
          section: f.section,
          sort_order: f.sort_order,
          question: f.question,
          default_owner: f.default_owner,
          default_owner_set_by: null,
        })),
      );
      writes.fields += rows.length;
    },

    async updateOwner(fieldId, owner) {
      for (const rows of fields.values()) {
        const row = rows.find((r) => r.id === fieldId);
        if (row) {
          row.default_owner = owner;
          writes.owners += 1;
          return;
        }
      }
      throw new Error(`No such field: ${fieldId}`);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Parse the workbook exactly as the importer does                            */
/* -------------------------------------------------------------------------- */

const SHEETS = [
  ["Core Questions", "core", "core"],
  ["Law Firms", "law_firms", "segment"],
  ["B2B Tech", "b2b_tech", "segment"],
  ["Associations", "associations", "segment"],
  ["AMC", "amc", "segment"],
  ["Trade Show Organizers", "trade_show_organizers", "segment"],
  ["B2B Media", "b2b_media", "segment"],
  ["First Time Conference", "first_time_conference", "situational"],
  ["New Market Entry", "new_market_entry", "situational"],
];

const book = XLSX.read(readFileSync(WORKBOOK), { type: "buffer", cellStyles: true });

function parseSheet(name) {
  const ws = book.Sheets[name];
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      const text = cell?.v === undefined ? "" : String(cell.v).trim();
      if (!text) continue;
      const fg = cell?.s?.fgColor;
      rows.push({
        text,
        fill: fg?.rgb ? String(fg.rgb) : fg?.theme !== undefined ? `theme${fg.theme}` : "NONE",
      });
      break;
    }
  }
  const [, ...body] = rows;
  const freq = new Map();
  for (const row of body) freq.set(row.fill, (freq.get(row.fill) ?? 0) + 1);
  const questionFill = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const sections = [];
  let current = null;
  for (const row of body) {
    if (row.fill !== questionFill) {
      current = { section: row.text, questions: [] };
      sections.push(current);
    } else {
      if (!current) {
        current = { section: "General", questions: [] };
        sections.push(current);
      }
      current.questions.push(row.text);
    }
  }
  return sections;
}

const AMZAI_OWNED_SECTIONS = new Set(["Record"]);

function sheetFor([name, slug, kind]) {
  const fields = [];
  let order = 0;
  for (const section of parseSheet(name)) {
    for (const question of section.questions) {
      order += 1;
      fields.push({
        section: section.section,
        sort_order: order,
        question,
        guidance: null,
        default_owner: AMZAI_OWNED_SECTIONS.has(section.section.trim()) ? "amzai" : "client",
        default_assignee_role: "delivery_lead",
        default_offset_type: "weeks_from_start",
        default_offset_value: 2,
        blocking: false,
        duplicate_kind: null,
        duplicate_of: null,
      });
    }
  }
  return { slug, name, kind, clientTypeId: null, subSegmentId: null, fields };
}

const sheets = SHEETS.map(sheetFor);

/* -------------------------------------------------------------------------- */
/* Import it twice                                                            */
/* -------------------------------------------------------------------------- */

const store = makeStore();

const first = [];
for (const sheet of sheets) first.push(await importSheet(store, sheet));

check("first run creates every set", first.every((o) => o.action === "created"),
  first.map((o) => o.action).join(", "));
check("nine sets", store.all().length === 9, `got ${store.all().length}`);
check("416 questions", store.writes.fields === 416, `got ${store.writes.fields}`);

const afterFirst = { ...store.writes };
const second = [];
for (const sheet of sheets) second.push(await importSheet(store, sheet));

// This is the whole point of the file.
check("second run reports every sheet unchanged",
  second.every((o) => o.action === "unchanged"),
  second.filter((o) => o.action !== "unchanged").map((o) => `${o.name}=${o.action}`).join(", "));
check("second run writes no template", store.writes.templates === afterFirst.templates,
  `${store.writes.templates - afterFirst.templates} written`);
check("second run writes no field", store.writes.fields === afterFirst.fields,
  `${store.writes.fields - afterFirst.fields} written`);
check("second run touches no owner", store.writes.owners === afterFirst.owners,
  `${store.writes.owners - afterFirst.owners} touched`);
check("still nine sets, all v1",
  store.all().length === 9 && store.all().every((t) => t.version === 1));

const third = [];
for (const sheet of sheets) third.push(await importSheet(store, sheet));
check("and a third run too", third.every((o) => o.action === "unchanged"));

/* -------------------------------------------------------------------------- */
/* A changed sheet does become a new version                                   */
/* -------------------------------------------------------------------------- */

{
  const changed = structuredClone(sheets);
  changed[0].fields[0].question = "Reworded in the workbook";
  const outcomes = [];
  for (const sheet of changed) outcomes.push(await importSheet(store, sheet));

  check("a reworded question makes a new version",
    outcomes[0].action === "new version" && outcomes[0].version === 2,
    `${outcomes[0].action} v${outcomes[0].version}`);
  check("and only that sheet", outcomes.filter((o) => o.action !== "unchanged").length === 1);
  check("the previous version is still there",
    store.all().filter((t) => t.slug === "core").length === 2);
  check("with its original wording intact",
    store.all().find((t) => t.slug === "core" && t.version === 1).fields[0].question
      !== "Reworded in the workbook");
}

/* -------------------------------------------------------------------------- */
/* Changing an importer default does not make a version                        */
/* -------------------------------------------------------------------------- */

{
  const fresh = makeStore();
  const one = [sheets[1]]; // Law Firms, no Record section
  await importSheet(fresh, one[0]);

  const retuned = structuredClone(one);
  for (const f of retuned[0].fields) f.default_owner = "both";
  const outcome = await importSheet(fresh, retuned[0]);

  check("changing an owner default is not a new version", outcome.action === "unchanged",
    outcome.action);
  check("it retunes the rows instead", outcome.retuned === 47, `retuned ${outcome.retuned}`);
  check("and the retune stuck",
    (await fresh.latestBySlug("law_firms")).fields.every((f) => f.default_owner === "both"));
}

{
  // A person's decision outranks the importer's default. SPEC.md section 3.
  const fresh = makeStore();
  await importSheet(fresh, sheets[1]);
  const stored = await fresh.latestBySlug("law_firms");
  stored.fields[0].default_owner_set_by = "a-real-person";
  stored.fields[0].default_owner = "amzai";

  const retuned = structuredClone(sheets[1]);
  for (const f of retuned.fields) f.default_owner = "both";
  const outcome = await importSheet(fresh, retuned);

  check("an owner a person set is left alone", outcome.leftAlone === 1, `${outcome.leftAlone}`);
  check("and the rest are retuned", outcome.retuned === 46, `${outcome.retuned}`);
  check("the person's choice survives",
    (await fresh.latestBySlug("law_firms")).fields[0].default_owner === "amzai");
}

/* -------------------------------------------------------------------------- */
/* The hash is provenance, not the decision                                    */
/* -------------------------------------------------------------------------- */

{
  const a = structuredClone(sheets[1]);
  const b = structuredClone(sheets[1]);
  for (const f of b.fields) {
    f.default_owner = "amzai";
    f.default_offset_value = 9;
    f.blocking = true;
  }

  check("the hash ignores the importer's own defaults",
    contentHash(a.slug, a.kind, a.fields) === contentHash(b.slug, b.kind, b.fields));
  check("and so does the comparison the decision uses",
    sameContent(
      a.fields.map((f, i) => ({ ...f, id: `x${i}`, default_owner_set_by: null })),
      b.fields,
    ));

  const c = structuredClone(sheets[1]);
  c.fields[3].question = "Different";
  check("but a changed question is seen",
    !sameContent(
      a.fields.map((f, i) => ({ ...f, id: `x${i}`, default_owner_set_by: null })),
      c.fields,
    ));
}

/* -------------------------------------------------------------------------- */

console.log("\n  Importing the same workbook twice\n  " + "-".repeat(64));
for (const r of results) {
  console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : "\n        " + r.detail}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n  ${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
