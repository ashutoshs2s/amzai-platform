/**
 * Client-safe half of the taxonomy: the shapes and the one constant the
 * screens need.
 *
 * Kept apart from lib/data/taxonomy.ts, which is server-only because it reads
 * the database. A client component importing that would pull `server-only`
 * into the browser bundle and fail the build, which is the guard working.
 */

export type SubSegment = {
  id: string;
  slug: string;
  label: string;
};

export type ClientType = {
  id: string;
  slug: string;
  label: string;
  subSegments: SubSegment[];
};

/** Shown where a client type has no sub-segments, as Law Firms does not. */
export const NO_SUB_SEGMENT = "—";
