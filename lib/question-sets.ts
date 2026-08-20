/**
 * Labels and shapes for the question sets, client-safe.
 *
 * Split from lib/data/question-sets.ts, which reads the database and is
 * server-only. A client component that imported the reader would drag
 * next/headers into the browser bundle, and the build refuses it — correctly,
 * since that is also how a service role key would escape.
 */

export const KIND_LABEL: Record<string, string> = {
  core: "Core",
  segment: "Segment",
  situational: "Situational",
};

export const OWNER_LABEL: Record<string, string> = {
  client: "Client",
  amzai: "Amzai",
  both: "Both",
};

export const OWNERS = ["client", "amzai", "both"];

export type QuestionSetSummary = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  version: number;
  appliesTo: string;
  questionCount: number;
  amzaiOwned: number;
  clientOwned: number;
  bothOwned: number;
  /** How many owners a person has set by hand. */
  tuned: number;
};

export type FieldTaskTemplate = {
  id: string;
  title: string;
  detail: string | null;
  role: string | null;
  offsetType: string;
  offsetValue: number;
  blocking: boolean;
};

export type QuestionSetField = {
  id: string;
  question: string;
  sortOrder: number;
  owner: string;
  setByName: string | null;
  setAt: string | null;
  duplicateKind: string | null;
  duplicateOf: string | null;
  /** What work approving this question produces. Usually none. */
  tasks: FieldTaskTemplate[];
};

export type QuestionSetDetail = QuestionSetSummary & {
  sections: { section: string; fields: QuestionSetField[] }[];
};
