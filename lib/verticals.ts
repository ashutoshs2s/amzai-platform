/**
 * Client verticals and sub-verticals. SPEC.md section 3, DESIGN.md section 6.1.
 *
 * How a client organisation is classified. Two verticals have sub-verticals,
 * one does not: Law Firms are not subdivided, and its sub-vertical is null in
 * the database and an em dash on screen.
 *
 * **Slugs are stored, labels are displayed.** The database holds
 * `identity_access`; this file is the only place that knows it is spelled
 * "Identity & Access". Renaming a sub-vertical is therefore a one-line change
 * here, not an UPDATE across every organisation row, and both `vertical` and
 * `sub_vertical` follow the same snake_case convention.
 *
 * This is the single source for the list. The programme list, the filters and
 * the organisation record all read it, so there is nothing to drift.
 */

export type VerticalId = "b2b_tech" | "law_firms" | "conference_organizers";

export type SubVertical = {
  /** Stored in the database. */
  slug: string;
  /** Shown on screen. Never stored. */
  label: string;
};

export type Vertical = {
  id: VerticalId;
  label: string;
  subVerticals: SubVertical[];
};

export const VERTICALS: Vertical[] = [
  {
    id: "b2b_tech",
    label: "B2B Tech",
    subVerticals: [
      { slug: "cybersecurity", label: "Cybersecurity" },
      { slug: "identity_access", label: "Identity & Access" },
      { slug: "cloud_infrastructure", label: "Cloud & Infrastructure" },
      { slug: "data_analytics", label: "Data & Analytics" },
      { slug: "ai_ml", label: "AI & ML" },
      { slug: "devops_engineering", label: "DevOps & Engineering" },
      { slug: "networking", label: "Networking" },
      { slug: "observability", label: "Observability" },
      { slug: "storage_backup", label: "Storage & Backup" },
      { slug: "fintech", label: "FinTech" },
      { slug: "martech", label: "MarTech" },
      { slug: "hr_tech", label: "HR Tech" },
      { slug: "supply_chain_tech", label: "Supply Chain Tech" },
      { slug: "healthcare_tech", label: "Healthcare Tech" },
      {
        slug: "erp_business_applications",
        label: "ERP & Business Applications",
      },
      { slug: "customer_experience", label: "Customer Experience" },
    ],
  },
  {
    id: "law_firms",
    label: "Law Firms",
    subVerticals: [],
  },
  {
    id: "conference_organizers",
    label: "Conference Organizers",
    subVerticals: [
      { slug: "associations", label: "Associations" },
      { slug: "amcs", label: "AMCs" },
      { slug: "b2b_media", label: "B2B Media" },
      { slug: "trade_show_organizers", label: "Trade Show Organizers" },
    ],
  },
];

/** Shown in the Sub-vertical cell and filter where a vertical has none. */
export const NO_SUB_VERTICAL = "—";

export function verticalById(id: VerticalId): Vertical {
  const found = VERTICALS.find((vertical) => vertical.id === id);
  if (!found) throw new Error(`Unknown vertical: ${id}`);
  return found;
}

export function verticalLabel(id: VerticalId): string {
  return verticalById(id).label;
}

/** Whether this vertical is subdivided at all. */
export function hasSubVerticals(id: VerticalId): boolean {
  return verticalById(id).subVerticals.length > 0;
}

/**
 * Options for the Sub-vertical filter, given the current Vertical filter.
 * With no vertical chosen, every sub-vertical across the verticals that have
 * them; with one chosen, only that vertical's.
 */
export function subVerticalOptions(vertical: VerticalId | "all"): SubVertical[] {
  if (vertical === "all") {
    return VERTICALS.flatMap((entry) => entry.subVerticals);
  }
  return verticalById(vertical).subVerticals;
}

/**
 * Display label for a stored slug. Returns the slug itself if it is not
 * recognised, so an unknown value shows up on screen rather than rendering as
 * a blank that looks like missing data.
 */
export function subVerticalLabel(slug: string | null): string | null {
  if (!slug) return null;
  for (const vertical of VERTICALS) {
    const match = vertical.subVerticals.find((entry) => entry.slug === slug);
    if (match) return match.label;
  }
  return slug;
}

/** Whether a slug belongs to a given vertical. Mirrors the check constraint. */
export function isValidSubVertical(
  vertical: VerticalId,
  slug: string | null,
): boolean {
  const options = verticalById(vertical).subVerticals;
  if (options.length === 0) return slug === null;
  return slug === null || options.some((entry) => entry.slug === slug);
}
