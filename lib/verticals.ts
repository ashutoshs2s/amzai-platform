/**
 * Client verticals and sub-verticals. DESIGN.md section 6.1.
 *
 * How a client organisation is classified. Two verticals have sub-verticals,
 * one does not: Law Firms are not subdivided, and its sub-vertical renders as
 * an em dash rather than an empty cell.
 *
 * This lives in one place because the programme list, the filters and
 * eventually the organisation record all need the same list, and three copies
 * would drift.
 */

export type VerticalId = "b2b_tech" | "law_firms" | "conference_organizers";

export type Vertical = {
  id: VerticalId;
  label: string;
  subVerticals: string[];
};

export const VERTICALS: Vertical[] = [
  {
    id: "b2b_tech",
    label: "B2B Tech",
    subVerticals: [
      "Cybersecurity",
      "Identity & Access",
      "Cloud & Infrastructure",
      "Data & Analytics",
      "AI & ML",
      "DevOps & Engineering",
      "Networking",
      "Observability",
      "Storage & Backup",
      "FinTech",
      "MarTech",
      "HR Tech",
      "Supply Chain Tech",
      "Healthcare Tech",
      "ERP & Business Applications",
      "Customer Experience",
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
    subVerticals: ["Associations", "AMCs", "B2B Media", "Trade Show Organizers"],
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
export function subVerticalOptions(vertical: VerticalId | "all"): string[] {
  if (vertical === "all") {
    return VERTICALS.flatMap((entry) => entry.subVerticals);
  }
  return verticalById(vertical).subVerticals;
}
