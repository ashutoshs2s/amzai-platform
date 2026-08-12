/**
 * Prove the generation rules.
 *
 *   npm run test-generation
 *
 * Runs against the real resolver with made-up templates. Nothing here touches
 * the database, because the rules being tested are about which sets get chosen
 * and why, and those must hold whatever the workbook happens to contain today.
 */

import { resolveQuestions, situationalModulesFor } from "../lib/generation/resolve.ts";

const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass, detail });
const eq = (name, actual, expected) =>
  check(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`,
  );

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const TYPE = { b2bTech: "type-b2b", conf: "type-conf", law: "type-law" };
const SEG = {
  erp: "seg-erp",
  association: "seg-assoc",
  tradeShow: "seg-trade",
  hostedBuyer: "seg-hosted",
};

let fieldId = 0;
const field = (question, extra = {}) => ({
  id: `f${(fieldId += 1)}`,
  section: extra.section ?? "General",
  sortOrder: extra.sortOrder ?? fieldId,
  question,
  guidance: null,
  defaultOwner: "client",
  defaultAssigneeRole: "delivery_lead",
  defaultOffsetType: "weeks_from_start",
  defaultOffsetValue: 2,
  blocking: false,
});

const template = (slug, kind, questions, extra = {}) => ({
  id: extra.id ?? `t-${slug}-v${extra.version ?? 1}`,
  slug,
  name: extra.name ?? slug,
  kind,
  version: extra.version ?? 1,
  programType: extra.programType ?? null,
  clientTypeId: extra.clientTypeId ?? null,
  subSegmentId: extra.subSegmentId ?? null,
  fields: questions.map((q) => field(q)),
});

const CORE = template("core", "core", [
  "Who is the target audience? Titles, functions and seniority.",
  "What is the do not contact list, and who maintains it?",
  "Onboarding recording link",
]);

const B2B_TECH = template("b2b_tech", "segment", ["Which products are in scope?"], {
  clientTypeId: TYPE.b2bTech,
});
const ASSOCIATIONS = template("associations", "segment", ["How many members?"], {
  clientTypeId: TYPE.conf,
  subSegmentId: SEG.association,
});
const TRADE_SHOW = template("trade_show_organizers", "segment", ["How much floor space?"], {
  clientTypeId: TYPE.conf,
  subSegmentId: SEG.tradeShow,
});
const FIRST_TIME = template(
  "first_time_conference",
  "situational",
  [
    "Onboarding recording link", // exact duplicate of core
    "Who is the target audience: titles, functions, seniority, company profile?", // near
    "What does a first event have to prove?",
  ],
  { clientTypeId: TYPE.conf, name: "First Time Conference" },
);
const LAW_ONLY_MODULE = template("law_module", "situational", ["Which practice areas?"], {
  clientTypeId: TYPE.law,
  name: "Law Module",
});

const ALL = [CORE, B2B_TECH, ASSOCIATIONS, TRADE_SHOW, FIRST_TIME, LAW_ONLY_MODULE];

const selection = (over = {}) => ({
  clientTypeId: TYPE.conf,
  clientTypeLabel: "Conference Organizers",
  subSegmentId: SEG.association,
  subSegmentLabel: "Association",
  borrowsFromSubSegmentId: null,
  borrowsFromLabel: null,
  programType: "event",
  situationalSlugs: [],
  ...over,
});

/* -------------------------------------------------------------------------- */
/* The segment set is chosen by sub-segment, then borrow, then client type     */
/* -------------------------------------------------------------------------- */

{
  const plan = resolveQuestions(ALL, selection());
  eq("association: core then its own set", plan.sets.map((s) => s.slug), ["core", "associations"]);
  eq("association: roles", plan.sets.map((s) => s.role), ["core", "segment"]);
  check("association: reason names the sub-segment",
    plan.sets[1].reason === "Chosen by sub-segment: Association.", plan.sets[1].reason);
  eq("association: total", plan.total, 4);
  check("association: nothing generic", plan.questions.every((q) => !q.generic));
  eq("association: no problems", plan.problems, []);
}

{
  // B2B Tech has one set for all 25 of its sub-segments, so ERP falls to it.
  const plan = resolveQuestions(
    ALL,
    selection({
      clientTypeId: TYPE.b2bTech,
      clientTypeLabel: "B2B Tech",
      subSegmentId: SEG.erp,
      subSegmentLabel: "ERP",
    }),
  );
  eq("erp: falls back to the client type set", plan.sets.map((s) => s.slug), ["core", "b2b_tech"]);
  check("erp: reason says why",
    plan.sets[1].reason === "No set for ERP, so chosen by client type: B2B Tech.",
    plan.sets[1].reason);
  check("erp: not marked generic", plan.questions.every((q) => !q.generic));
}

{
  // Hosted Buyer has no sheet and borrows the trade show set.
  const plan = resolveQuestions(
    ALL,
    selection({
      subSegmentId: SEG.hostedBuyer,
      subSegmentLabel: "Hosted Buyer Organizer",
      borrowsFromSubSegmentId: SEG.tradeShow,
      borrowsFromLabel: "Trade Show Organizer",
    }),
  );
  eq("hosted buyer: borrows trade show", plan.sets.map((s) => s.slug), ["core", "trade_show_organizers"]);
  eq("hosted buyer: role is fallback", plan.sets[1].role, "fallback");
  check("hosted buyer: borrowed questions are generic",
    plan.questions.filter((q) => q.slug === "trade_show_organizers").every((q) => q.generic));
  check("hosted buyer: core questions are not generic",
    plan.questions.filter((q) => q.slug === "core").every((q) => !q.generic));
  check("hosted buyer: reason explains the borrow",
    plan.sets[1].reason.includes("no question set of its own"), plan.sets[1].reason);
}

{
  // A borrow is more specific than the client-type set, so it wins.
  const withClientLevel = [...ALL, template("conf_generic", "segment", ["Generic?"], {
    clientTypeId: TYPE.conf,
  })];
  const plan = resolveQuestions(
    withClientLevel,
    selection({
      subSegmentId: SEG.hostedBuyer,
      subSegmentLabel: "Hosted Buyer Organizer",
      borrowsFromSubSegmentId: SEG.tradeShow,
      borrowsFromLabel: "Trade Show Organizer",
    }),
  );
  eq("a named borrow beats the client-type set",
    plan.sets.map((s) => s.slug), ["core", "trade_show_organizers"]);
}

{
  const plan = resolveQuestions(
    [CORE],
    selection({ subSegmentId: "seg-unknown", subSegmentLabel: "Something New" }),
  );
  eq("no set at all: core only", plan.sets.map((s) => s.slug), ["core"]);
  check("no set at all: says so", plan.problems.length === 1
    && plan.problems[0].message.includes("Something New"), JSON.stringify(plan.problems));
}

/* -------------------------------------------------------------------------- */
/* Situational modules append, and duplicates resolve                          */
/* -------------------------------------------------------------------------- */

{
  const plan = resolveQuestions(ALL, selection({ situationalSlugs: ["first_time_conference"] }));

  eq("module appends last", plan.sets.map((s) => s.slug),
    ["core", "associations", "first_time_conference"]);

  eq("the exact duplicate is dropped", plan.dropped.length, 1);
  check("core wins the duplicate",
    plan.dropped[0].question === "Onboarding recording link"
      && plan.dropped[0].alreadyIn === "core"
      && plan.dropped[0].fromSet === "First Time Conference",
    JSON.stringify(plan.dropped[0]));
  check("the dropped question is asked exactly once",
    plan.questions.filter((q) => q.field.question === "Onboarding recording link").length === 1);

  eq("the near duplicate is kept", plan.near.length, 1);
  check("and marked against core's wording",
    plan.near[0].nearDuplicateOf.setName === "core"
      && plan.near[0].nearDuplicateOf.score >= 0.8
      && plan.near[0].nearDuplicateOf.score < 1,
    JSON.stringify(plan.near[0].nearDuplicateOf));

  eq("counts add up", plan.total, 6);
  eq("the module reports offered and contributed",
    [plan.sets[2].offered, plan.sets[2].contributed], [3, 2]);
}

{
  const plan = resolveQuestions(ALL, selection({ situationalSlugs: ["law_module"] }));
  eq("a module for another client type is left out",
    plan.sets.map((s) => s.slug), ["core", "associations"]);
  check("and the admin is told", plan.problems.some((p) => p.message.includes("Law Module")),
    JSON.stringify(plan.problems));
}

{
  const plan = resolveQuestions(ALL, selection({ situationalSlugs: ["not_a_module"] }));
  check("an unknown module is reported, not ignored",
    plan.problems.some((p) => p.message.includes("not_a_module")), JSON.stringify(plan.problems));
}

{
  const modules = situationalModulesFor(ALL, TYPE.conf, "event");
  eq("only applicable modules are offered", modules.map((m) => m.slug), ["first_time_conference"]);
  eq("and none for a client type with no module",
    situationalModulesFor(ALL, "type-other", "event").map((m) => m.slug), []);
}

/* -------------------------------------------------------------------------- */
/* Versions, programme types, determinism                                      */
/* -------------------------------------------------------------------------- */

{
  const v2 = template("associations", "segment", ["How many members?", "Added in v2"], {
    clientTypeId: TYPE.conf,
    subSegmentId: SEG.association,
    version: 2,
  });
  const plan = resolveQuestions([...ALL, v2], selection());
  eq("the newest version wins", plan.sets.find((s) => s.slug === "associations").version, 2);
  eq("and only once", plan.sets.filter((s) => s.slug === "associations").length, 1);
  check("its questions are the new ones",
    plan.questions.some((q) => q.field.question === "Added in v2"));
}

{
  const retainerOnly = template("retainer_extra", "segment", ["Retainer only?"], {
    clientTypeId: TYPE.conf,
    subSegmentId: SEG.association,
    programType: "retainer",
    version: 5,
  });
  const forEvent = resolveQuestions([...ALL, retainerOnly], selection({ programType: "event" }));
  eq("a retainer set is not used on an event",
    forEvent.sets.map((s) => s.slug), ["core", "associations"]);

  const forRetainer = resolveQuestions([...ALL, retainerOnly], selection({ programType: "retainer" }));
  check("but is used on a retainer",
    forRetainer.sets.some((s) => s.slug === "retainer_extra"),
    forRetainer.sets.map((s) => s.slug).join(", "));
}

{
  const a = resolveQuestions(ALL, selection({ situationalSlugs: ["first_time_conference"] }));
  const b = resolveQuestions(ALL, selection({ situationalSlugs: ["first_time_conference"] }));
  check("the same selections always give the same plan",
    JSON.stringify(a) === JSON.stringify(b));

  const shuffled = [...ALL].reverse();
  const c = resolveQuestions(shuffled, selection({ situationalSlugs: ["first_time_conference"] }));
  eq("and the row order out of the database does not matter",
    c.questions.map((q) => q.field.question), a.questions.map((q) => q.field.question));
}

/* -------------------------------------------------------------------------- */

console.log("\n  Generation rules\n  " + "-".repeat(64));
for (const r of results) {
  console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : "\n        " + r.detail}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n  ${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
