/**
 * Import the onboarding question sets from the workbook.
 *
 *   npm run import-questions            write to the database
 *   npm run import-questions -- --dry   parse and report, write nothing
 *
 * Re-runnable by design. Each sheet is hashed; an unchanged sheet writes
 * nothing at all. A changed sheet becomes a NEW version, and nothing existing
 * is edited or deleted, because programmes already generated point at the
 * version they were generated from and must keep seeing it. SPEC.md 4.1.
 *
 * Uses the service role, so it bypasses row level security. Correct for an
 * import run by hand from a terminal, wrong for anything the app imports.
 * `xlsx` is a devDependency and is referenced only here, never by the app.
 */

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

import { isExactDuplicate, NEAR_DUPLICATE, similarity } from "../lib/generation/matching.ts";
import { importSheet } from "../lib/import/plan.ts";

/*
  The workbook, overridable with --file= for checking a corrected copy before
  it replaces this one. The default is the version the question sets were last
  imported from, so a plain run is never ambiguous about what it read.
*/
const DEFAULT_WORKBOOK = "data/Amzai_Dedicated_Team_Onboarding-5.xlsx";
const WORKBOOK =
  process.argv.find((a) => a.startsWith("--file="))?.slice("--file=".length) ??
  DEFAULT_WORKBOOK;
const DRY = process.argv.includes("--dry");

/**
 * What each sheet is, and where it applies. `Plan` is absent on purpose: it is
 * a project plan, not a question set, and importing it would put schedule rows
 * into onboarding.
 */
const SHEETS = [
  { sheet: "Core Questions",        slug: "core",                  kind: "core",        clientType: null,                    subSegment: null },
  { sheet: "Law Firms",             slug: "law_firms",             kind: "segment",     clientType: "law_firms",             subSegment: null },
  { sheet: "B2B Tech",              slug: "b2b_tech",              kind: "segment",     clientType: "b2b_tech",              subSegment: null },
  { sheet: "Associations",          slug: "associations",          kind: "segment",     clientType: "conference_organizers", subSegment: "association" },
  { sheet: "AMC",                   slug: "amc",                   kind: "segment",     clientType: "conference_organizers", subSegment: "amc" },
  { sheet: "Trade Show Organizers", slug: "trade_show_organizers", kind: "segment",     clientType: "conference_organizers", subSegment: "trade_show_organizer" },
  { sheet: "B2B Media",             slug: "b2b_media",             kind: "segment",     clientType: "conference_organizers", subSegment: "b2b_media" },
  { sheet: "First Time Conference", slug: "first_time_conference", kind: "situational", clientType: "conference_organizers", subSegment: null },
  { sheet: "New Market Entry",      slug: "new_market_entry",      kind: "situational", clientType: "conference_organizers", subSegment: null },
];

/*
  The one thing the workbook says about ownership, said by its own vocabulary.

  A "Record" section asks for links to recordings of calls Amzai ran. Those are
  Amzai's artefacts, not the client's, and asking a client for them would be
  asking them for something we hold. It appears in three sheets under exactly
  this name.

  Everything else imports as the client's, which is what the workbook is: a set
  of questions Amzai asks a client. Nothing is inferred from the wording of an
  individual question, because that would be a heuristic, and a wrong owner is
  invisible until a deadline is missed. Ownership beyond this is a judgement,
  and it is corrected in the app, per question, without re-importing.
*/
const AMZAI_OWNED_SECTIONS = new Set(["Record"]);

const ownerFor = (section) =>
  AMZAI_OWNED_SECTIONS.has(section.trim()) ? "amzai" : "client";

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

// readFile is not available in the ESM build, which has no filesystem
// adapter bound. Read the bytes here and hand XLSX a buffer.
const book = XLSX.read(readFileSync(WORKBOOK), {
  type: "buffer",
  cellStyles: true,
});

/** The fill of a cell, or NONE. Colour is read, never matched against a list. */
function fillOf(cell) {
  const fg = cell?.s?.fgColor;
  if (!fg) return "NONE";
  if (fg.rgb) return String(fg.rgb);
  if (fg.theme !== undefined) return `theme${fg.theme}:${fg.tint ?? 0}`;
  return "NONE";
}

/**
 * Rows of a sheet: the text of the first non-empty cell, its fill, and the
 * spreadsheet row it came from.
 *
 * The row number is carried all the way through to the warnings below. A
 * warning that says a row looks wrong without saying which row is a warning
 * somebody has to go hunting for, and a hunt is what gets skipped.
 */
function rowsOf(sheetName) {
  const ws = book.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet not found: ${sheetName}`);
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const rows = [];

  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      const text = cell?.v === undefined ? "" : String(cell.v).trim();
      if (!text) continue;
      rows.push({
        text,
        fill: fillOf(cell),
        row: r + 1, // 1-based, as Excel shows it
        column: XLSX.utils.encode_col(c),
      });
      break; // first non-empty cell in the row decides
    }
  }
  return rows;
}

/**
 * Split a sheet into sections and questions.
 *
 * Headers are NOT detected by "has a fill". Half the workbook fills every row:
 * Core Questions fills only its headers, while B2B Tech, B2B Media, AMC and
 * both situational sheets fill headers dark and questions in a light tint. A
 * has-fill rule reports First Time Conference as 84 headers and 0 questions.
 *
 * So the sheet calibrates itself: whichever fill is most common is the question
 * fill, and every other fill is a header. Colour-agnostic, and it keeps working
 * when somebody restyles a sheet or adds a new one.
 */
function parseSheet(sheetName) {
  const rows = rowsOf(sheetName);
  if (rows.length === 0) return { title: null, sections: [] };

  const [title, ...body] = rows; // row one is "Questions | Responses"

  const freq = new Map();
  for (const row of body) freq.set(row.fill, (freq.get(row.fill) ?? 0) + 1);
  const questionFill = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const sections = [];
  let current = null;
  for (const row of body) {
    if (row.fill !== questionFill) {
      current = { section: row.text, row: row.row, column: row.column, questions: [] };
      sections.push(current);
    } else {
      if (!current) {
        current = { section: "General", row: row.row, column: row.column, questions: [] };
        sections.push(current);
      }
      current.questions.push(row.text);
    }
  }
  return { title: title.text, questionFill, sections };
}

/* -------------------------------------------------------------------------- */
/* Overlaps                                                                   */
/* -------------------------------------------------------------------------- */

/*
  The duplicate rule lives in lib/generation/matching.ts and is imported, not
  copied. Generation uses the same one. If this file had its own, the overlap
  report printed here could promise something generation would not do.
*/


/* -------------------------------------------------------------------------- */
/* Parse everything, then report                                              */
/* -------------------------------------------------------------------------- */

const parsed = SHEETS.map((s) => ({ ...s, ...parseSheet(s.sheet) }));

console.log(`\n${WORKBOOK}${DRY ? "   (dry run, nothing will be written)" : ""}\n`);
console.log("  sheet                     sections  questions  question fill");
console.log("  " + "-".repeat(66));
for (const p of parsed) {
  const q = p.sections.reduce((n, s) => n + s.questions.length, 0);
  console.log(
    `  ${p.sheet.padEnd(24)}${String(p.sections.length).padStart(9)}${String(q).padStart(11)}  ${p.questionFill}`,
  );
}
const total = parsed.reduce(
  (n, p) => n + p.sections.reduce((m, s) => m + s.questions.length, 0),
  0,
);
console.log("  " + "-".repeat(66));
console.log(`  ${"total".padEnd(24)}${String(parsed.reduce((n, p) => n + p.sections.length, 0)).padStart(9)}${String(total).padStart(11)}`);
console.log("\n  Plan is not a question set and is not imported.");

/*
  Ownership is printed on every run for the same reason the counts are: it is a
  rule applied to somebody else's spreadsheet, and a silent rule is one nobody
  checks.
*/
const amzaiOwned = parsed.flatMap((p) =>
  p.sections
    .filter((s) => AMZAI_OWNED_SECTIONS.has(s.section.trim()))
    .map((s) => ({ sheet: p.sheet, section: s.section, count: s.questions.length })),
);
const amzaiTotal = amzaiOwned.reduce((n, s) => n + s.count, 0);
console.log(
  `\n  Ownership: ${total - amzaiTotal} client, ${amzaiTotal} Amzai.` +
    ` Amzai-owned sections are ${[...AMZAI_OWNED_SECTIONS].join(", ")}:`,
);
for (const s of amzaiOwned) console.log(`    ${s.sheet} / ${s.section}  ${s.count}`);
console.log("  Everything else is the client's. Retune per question in the app.");

/*
  Probable mis-styled questions.

  A row styled like a heading but reading like a question is almost certainly a
  question whose fill is wrong in the workbook. It classifies as a section, so
  it is never asked, and the loss is silent: the counts still look plausible
  because the sheet simply appears to have more sections than it does.

  This WARNS and changes nothing. The classification stays exactly as the
  colours say it is. Correcting the fill in the workbook is exact; a rule that
  reclassified on wording would be a heuristic, and a heuristic would eventually
  mis-classify something with nobody able to say which question went missing.
*/
const SECTION_NAME_LIMIT = 80;

const probableQuestions = parsed.flatMap((p) =>
  p.sections
    .filter(
      (s) => s.section.trim().endsWith("?") || s.section.trim().length > SECTION_NAME_LIMIT,
    )
    .map((s) => ({
      sheet: p.sheet,
      row: s.row,
      column: s.column,
      section: s.section.trim(),
      questions: s.questions.length,
      why: s.section.trim().endsWith("?") ? "ends in a question mark" : `over ${SECTION_NAME_LIMIT} characters`,
    })),
);

if (probableQuestions.length > 0) {
  console.log(
    `\n  WARNING: ${probableQuestions.length} section${probableQuestions.length === 1 ? "" : "s"} read like questions.`,
  );
  console.log("  Imported as sections, exactly as their fill says, so they are NOT asked.");
  console.log("  If they are questions, fix the fill in the workbook and import again.\n");
  console.log("    sheet                     cell    reason                    text");
  console.log("    " + "-".repeat(94));
  for (const s of probableQuestions) {
    const head = s.section.length > 46 ? `${s.section.slice(0, 46)}…` : s.section;
    console.log(
      `    ${s.sheet.padEnd(24)}  ${`${s.column}${s.row}`.padEnd(6)}  ${s.why.padEnd(24)}  ${head}`,
    );
  }
}

/*
  A miscalibration shows up here as a sheet with almost no questions, or almost
  no sections. Both are printed on every run for exactly that reason.
*/
const suspicious = parsed.filter((p) => {
  const q = p.sections.reduce((n, s) => n + s.questions.length, 0);
  return q < 5 || p.sections.length < 2 || q < p.sections.length;
});
if (suspicious.length > 0) {
  console.log("\n  CHECK THESE — the header calibration looks wrong:");
  for (const p of suspicious) console.log(`    ${p.sheet}`);
}

/* -------------------------------------------------------------------------- */
/* Overlap report                                                             */
/* -------------------------------------------------------------------------- */

const core = parsed.find((p) => p.slug === "core");
const coreQuestions = core.sections.flatMap((s) =>
  s.questions.map((q) => ({ question: q, where: `Core Questions / ${s.section}` })),
);

const overlaps = [];
for (const situational of parsed.filter((p) => p.kind === "situational")) {
  for (const section of situational.sections) {
    for (const question of section.questions) {
      let best = null;
      for (const c of coreQuestions) {
        if (isExactDuplicate(question, c.question)) {
          best = { kind: "exact", score: 1, coreQuestion: c.question, where: c.where };
          break;
        }
        const score = similarity(question, c.question);
        if (score >= NEAR_DUPLICATE && (!best || score > best.score)) {
          best = { kind: "near", score, coreQuestion: c.question, where: c.where };
        }
      }
      if (best) {
        overlaps.push({
          sheet: situational.sheet,
          slug: situational.slug,
          section: section.section,
          question,
          ...best,
        });
      }
    }
  }
}

console.log("\n  Overlapping questions");
console.log("  " + "-".repeat(66));
if (overlaps.length === 0) {
  console.log("    none");
} else {
  for (const o of overlaps) {
    const tag = o.kind === "exact" ? "EXACT, dropped at generation" : `NEAR ${Math.round(o.score * 100)}%, both kept and marked`;
    console.log(`\n    ${o.sheet} / ${o.section}`);
    console.log(`      module asks: ${o.question}`);
    console.log(`      ${tag}`);
    console.log(`      also in ${o.where}`);
    if (o.kind === "near") console.log(`      Core asks:   ${o.coreQuestion}`);
  }
}

if (DRY) {
  console.log("\nDry run. Nothing written.\n");
  process.exit(0);
}

/* -------------------------------------------------------------------------- */
/* Write                                                                      */
/* -------------------------------------------------------------------------- */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("\nMissing Supabase variables. Run with: npm run import-questions");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

function fail(step, error) {
  if (!error) return;
  console.error(`\n✗ ${step}\n  ${error.message ?? error}`);
  process.exit(1);
}

const { data: types, error: typeError } = await db.from("client_types").select("id, slug");
fail("read client types", typeError);
const { data: segments, error: segError } = await db
  .from("client_sub_segments")
  .select("id, slug, client_type_id");
fail("read sub-segments", segError);

const typeId = Object.fromEntries(types.map((t) => [t.slug, t.id]));
const segmentId = (typeSlug, segSlug) =>
  segments.find((s) => s.client_type_id === typeId[typeSlug] && s.slug === segSlug)?.id ?? null;

/*
  What each sheet resolves to, ready for the importer to decide about. The
  workbook carries no deadline and no blocking flag, so those take one default
  for every question and are tuned in the app.
*/
const sheets = parsed.map((p) => {
  const fields = [];
  let order = 0;
  for (const section of p.sections) {
    for (const question of section.questions) {
      order += 1;
      const overlap = overlaps.find((o) => o.slug === p.slug && o.question === question);
      fields.push({
        section: section.section,
        sort_order: order,
        question,
        guidance: null,
        default_owner: ownerFor(section.section),
        default_assignee_role: "delivery_lead",
        default_offset_type: "weeks_from_start",
        default_offset_value: 2,
        blocking: false,
        duplicate_kind: overlap?.kind ?? null,
        duplicate_of: overlap ? overlap.where : null,
      });
    }
  }
  return {
    slug: p.slug,
    name: p.sheet,
    kind: p.kind,
    clientTypeId: p.clientType ? typeId[p.clientType] : null,
    subSegmentId: p.subSegment ? segmentId(p.clientType, p.subSegment) : null,
    fields,
  };
});

console.log("\n  Writing");
console.log("  " + "-".repeat(66));

/*
  The Supabase half of the store. Every decision about what to write lives in
  lib/import/plan.ts and is exercised by npm run test-import, which runs the
  same code twice against a store held in memory. This part only talks to the
  database.
*/
const store = {
  async latestBySlug(slug) {
    const { data, error } = await db
      .from("onboarding_templates")
      .select(
        `id, slug, version,
         fields:onboarding_template_fields (
           id, section, sort_order, question, default_owner, default_owner_set_by
         )`,
      )
      .eq("slug", slug)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    fail(`read ${slug}`, error);
    return data ? { ...data, fields: data.fields ?? [] } : null;
  },

  async createTemplate(input) {
    const { data, error } = await db
      .from("onboarding_templates")
      .insert({
        slug: input.slug,
        name: input.name,
        kind: input.kind,
        source_sheet: input.name,
        content_hash: input.contentHash,
        program_type: null,
        client_type_id: input.clientTypeId,
        sub_segment_id: input.subSegmentId,
        version: input.version,
        active: true,
      })
      .select("id")
      .single();
    fail(`insert ${input.slug} v${input.version}`, error);
    return data;
  },

  async insertFields(templateId, fields) {
    const { error } = await db
      .from("onboarding_template_fields")
      .insert(fields.map((f) => ({ ...f, template_id: templateId })));
    fail(`insert fields for ${templateId}`, error);
  },

  async updateOwner(fieldId, owner) {
    const { error } = await db
      .from("onboarding_template_fields")
      .update({ default_owner: owner })
      .eq("id", fieldId);
    fail("retune owner", error);
  },
};

for (const sheet of sheets) {
  const outcome = await importSheet(store, sheet);

  if (outcome.action === "unchanged") {
    const note =
      outcome.retuned > 0 || outcome.leftAlone > 0
        ? `  ${outcome.retuned} owner default${outcome.retuned === 1 ? "" : "s"} updated` +
          (outcome.leftAlone > 0 ? `, ${outcome.leftAlone} left as set in the app` : "")
        : "";
    console.log(`  unchanged    ${outcome.name.padEnd(24)} v${outcome.version}${note}`);
    continue;
  }

  const change =
    outcome.previousQuestionCount !== undefined
      ? `  ${outcome.previousQuestionCount} → ${outcome.questionCount} questions`
      : `  ${outcome.questionCount} questions`;
  console.log(
    `  ${outcome.action.padEnd(12)} ${outcome.name.padEnd(24)} v${outcome.version}${change}`,
  );
}

console.log("\nDone. Nothing was edited or deleted; changed sheets became new versions.\n");
