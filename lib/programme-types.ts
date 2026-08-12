/**
 * Programme types, client-safe.
 *
 * Split out of lib/data/programmes.ts, which reads the database and is
 * server-only. The labels are needed by a form in the browser, and a client
 * component importing the reader would drag next/headers into the bundle.
 *
 * The order is the order they are offered in. Event first because it is the
 * common case.
 */

export const PROGRAMME_TYPES = [
  "event",
  "retainer",
  "dedicated_team",
  "series",
  "research",
] as const;

export const PROGRAMME_TYPE_LABEL: Record<string, string> = {
  event: "Event",
  retainer: "Retainer",
  dedicated_team: "Dedicated team",
  series: "Series",
  research: "Research",
};

/**
 * Whether a type counts down to a fixed date rather than running in weeks.
 * SPEC.md section 7.2. It decides which dates a programme must carry.
 */
export function countsToMilestone(type: string): boolean {
  return type === "event" || type === "series";
}

export const ROLE_ON_PROGRAMME = [
  "engagement_lead",
  "delivery_lead",
  "specialist",
  "data_ops",
] as const;

/** admin is a system role, not a job on a programme. SPEC.md section 3. */
export const ROLE_ON_PROGRAMME_LABEL: Record<string, string> = {
  engagement_lead: "Engagement lead",
  delivery_lead: "Delivery lead",
  specialist: "Specialist",
  data_ops: "Data ops",
};
