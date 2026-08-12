import { isExactDuplicate, NEAR_DUPLICATE, similarity } from "./matching.ts";

/**
 * Which questions a programme gets, worked out from the selections.
 *
 * Nothing in this file names a client, a sub-segment or a sheet. It is handed
 * every template the database holds and a set of selections, and it decides.
 * That is the whole point: repointing a sub-segment, adding a new one, or
 * importing a new workbook changes what this returns without changing a line
 * of it, and no screen or route may hold the mapping instead.
 *
 * The relative, extension-carrying import below is deliberate. This module is
 * loaded both by the app and by plain Node in scripts and tests, and Node
 * resolves neither the @/ alias nor an extensionless specifier.
 *
 * It is also pure. No database, no request, no clock. So the preview the admin
 * approves and the set that gets written are produced by the same call, and
 * cannot disagree.
 */

export type TemplateKind = "core" | "segment" | "situational";

/** Why a set is in the plan. Shown to the admin before they commit. */
export type SetRole = "core" | "segment" | "situational" | "fallback";

export type TemplateField = {
  id: string;
  section: string;
  sortOrder: number;
  question: string;
  guidance: string | null;
  defaultOwner: "client" | "amzai" | "both";
  defaultAssigneeRole: string | null;
  defaultOffsetType: "weeks_from_start" | "days_before_milestone";
  defaultOffsetValue: number;
  blocking: boolean;
};

export type Template = {
  id: string;
  slug: string;
  name: string;
  kind: TemplateKind;
  version: number;
  /** Null means any programme type. */
  programType: string | null;
  clientTypeId: string | null;
  subSegmentId: string | null;
  fields: TemplateField[];
};

export type Selection = {
  clientTypeId: string;
  clientTypeLabel: string;
  subSegmentId: string | null;
  subSegmentLabel: string | null;
  /** Set when this sub-segment has no questions of its own. */
  borrowsFromSubSegmentId: string | null;
  borrowsFromLabel: string | null;
  programType: string;
  /** Slugs, in the order the admin chose them. */
  situationalSlugs: string[];
};

export type ChosenSet = {
  templateId: string;
  slug: string;
  name: string;
  version: number;
  role: SetRole;
  /** Plain English, shown in the preview. */
  reason: string;
  /** Questions this set contributed after duplicates were dropped. */
  contributed: number;
  /** Questions it offered before duplicates were dropped. */
  offered: number;
  generic: boolean;
};

export type PlannedQuestion = {
  field: TemplateField;
  templateId: string;
  slug: string;
  setName: string;
  role: SetRole;
  /** Borrowed from another sub-segment's set, so not written for this one. */
  generic: boolean;
  /** Close to a question already in the set, kept anyway. */
  nearDuplicateOf: { question: string; setName: string; score: number } | null;
};

export type DroppedQuestion = {
  question: string;
  section: string;
  fromSet: string;
  alreadyIn: string;
};

/** Something the admin needs to see before committing, not an exception. */
export type Problem = { message: string };

export type GenerationPlan = {
  sets: ChosenSet[];
  questions: PlannedQuestion[];
  dropped: DroppedQuestion[];
  near: PlannedQuestion[];
  problems: Problem[];
  total: number;
};

/** Newest version of each slug. Older versions stay readable, never chosen. */
function latestPerSlug(templates: Template[]): Template[] {
  const best = new Map<string, Template>();
  for (const t of templates) {
    const seen = best.get(t.slug);
    if (!seen || t.version > seen.version) best.set(t.slug, t);
  }
  return [...best.values()];
}

/** A template with no programme type applies to every programme type. */
function appliesToProgramType(t: Template, programType: string): boolean {
  return t.programType === null || t.programType === programType;
}

/**
 * The situational modules worth offering for a client type.
 *
 * The offer list comes from the same rows generation resolves against, so a
 * module can never be offered on a screen and then rejected at generation.
 */
export function situationalModulesFor(
  templates: Template[],
  clientTypeId: string,
  programType: string,
): Template[] {
  return latestPerSlug(
    templates.filter(
      (t) =>
        t.kind === "situational" &&
        appliesToProgramType(t, programType) &&
        (t.clientTypeId === null || t.clientTypeId === clientTypeId),
    ),
  ).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Pick the segment set.
 *
 * In order: this sub-segment's own set, then the set it borrows, then the one
 * for the client type as a whole. The order matters. A sub-segment that names
 * a borrow has said something specific, and that beats the generic client-type
 * set; a sub-segment that says nothing falls back to its client type, which is
 * how one B2B Tech set serves all of its sub-segments.
 */
function chooseSegmentSets(
  templates: Template[],
  selection: Selection,
): { sets: Template[]; role: SetRole; reason: string; generic: boolean } | null {
  const segments = latestPerSlug(
    templates.filter(
      (t) => t.kind === "segment" && appliesToProgramType(t, selection.programType),
    ),
  );

  if (selection.subSegmentId) {
    const own = segments.filter((t) => t.subSegmentId === selection.subSegmentId);
    if (own.length > 0) {
      return {
        sets: own,
        role: "segment",
        reason: `Chosen by sub-segment: ${selection.subSegmentLabel}.`,
        generic: false,
      };
    }
  }

  if (selection.borrowsFromSubSegmentId) {
    const borrowed = segments.filter(
      (t) => t.subSegmentId === selection.borrowsFromSubSegmentId,
    );
    if (borrowed.length > 0) {
      return {
        sets: borrowed,
        role: "fallback",
        reason:
          `${selection.subSegmentLabel} has no question set of its own, so it borrows ` +
          `${selection.borrowsFromLabel}. Every question from it is marked generic.`,
        generic: true,
      };
    }
  }

  const byClientType = segments.filter(
    (t) => t.clientTypeId === selection.clientTypeId && t.subSegmentId === null,
  );
  if (byClientType.length > 0) {
    return {
      sets: byClientType,
      role: "segment",
      reason: selection.subSegmentLabel
        ? `No set for ${selection.subSegmentLabel}, so chosen by client type: ${selection.clientTypeLabel}.`
        : `Chosen by client type: ${selection.clientTypeLabel}.`,
      generic: false,
    };
  }

  return null;
}

export function resolveQuestions(
  templates: Template[],
  selection: Selection,
): GenerationPlan {
  const sets: ChosenSet[] = [];
  const problems: Problem[] = [];
  const ordered: { template: Template; role: SetRole; reason: string; generic: boolean }[] = [];

  // Core always applies. More than one core set is allowed; the workbook has
  // one, and nothing here assumes that.
  const core = latestPerSlug(
    templates.filter(
      (t) => t.kind === "core" && appliesToProgramType(t, selection.programType),
    ),
  );
  if (core.length === 0) {
    problems.push({
      message:
        "There is no core question set. Import the workbook before generating, or this programme gets only its segment questions.",
    });
  }
  for (const template of core) {
    ordered.push({
      template,
      role: "core",
      reason: "Core applies to every programme.",
      generic: false,
    });
  }

  const segment = chooseSegmentSets(templates, selection);
  if (segment) {
    for (const template of segment.sets) {
      ordered.push({
        template,
        role: segment.role,
        reason: segment.reason,
        generic: segment.generic,
      });
    }
  } else {
    problems.push({
      message:
        `No question set covers ${selection.subSegmentLabel ?? selection.clientTypeLabel}. ` +
        `This programme would be generated from the core questions alone. Either import a set for it, ` +
        `or point it at an existing set to borrow.`,
    });
  }

  // Situational modules append, in the order they were chosen.
  const situational = latestPerSlug(templates.filter((t) => t.kind === "situational"));
  for (const slug of selection.situationalSlugs) {
    const template = situational.find((t) => t.slug === slug);
    if (!template) {
      problems.push({
        message: `The module "${slug}" was selected but is not in the database. It contributes nothing.`,
      });
      continue;
    }
    if (template.clientTypeId !== null && template.clientTypeId !== selection.clientTypeId) {
      problems.push({
        message: `${template.name} does not apply to ${selection.clientTypeLabel} and was left out.`,
      });
      continue;
    }
    if (!appliesToProgramType(template, selection.programType)) {
      problems.push({
        message: `${template.name} does not apply to a ${selection.programType} programme and was left out.`,
      });
      continue;
    }
    ordered.push({
      template,
      role: "situational",
      reason: "Selected for this programme.",
      generic: false,
    });
  }

  /*
    Duplicates are found here, over the set actually being built, rather than
    read off the marks the importer left. The importer only compared each
    module against core; two segment sets, or a future third module, would
    overlap in ways it never looked at. Whoever is first in the order wins,
    which is why core is added first.
  */
  const questions: PlannedQuestion[] = [];
  const dropped: DroppedQuestion[] = [];
  const seen: { question: string; setName: string }[] = [];

  for (const entry of ordered) {
    let contributed = 0;
    const fields = [...entry.template.fields].sort((a, b) => a.sortOrder - b.sortOrder);

    for (const field of fields) {
      const exact = seen.find((s) => isExactDuplicate(s.question, field.question));
      if (exact) {
        dropped.push({
          question: field.question,
          section: field.section,
          fromSet: entry.template.name,
          alreadyIn: exact.setName,
        });
        continue;
      }

      let near: PlannedQuestion["nearDuplicateOf"] = null;
      for (const s of seen) {
        const score = similarity(s.question, field.question);
        if (score >= NEAR_DUPLICATE && (!near || score > near.score)) {
          near = { question: s.question, setName: s.setName, score };
        }
      }

      questions.push({
        field,
        templateId: entry.template.id,
        slug: entry.template.slug,
        setName: entry.template.name,
        role: entry.role,
        generic: entry.generic,
        nearDuplicateOf: near,
      });
      seen.push({ question: field.question, setName: entry.template.name });
      contributed += 1;
    }

    sets.push({
      templateId: entry.template.id,
      slug: entry.template.slug,
      name: entry.template.name,
      version: entry.template.version,
      role: entry.role,
      reason: entry.reason,
      contributed,
      offered: entry.template.fields.length,
      generic: entry.generic,
    });
  }

  return {
    sets,
    questions,
    dropped,
    near: questions.filter((q) => q.nearDuplicateOf !== null),
    problems,
    total: questions.length,
  };
}
