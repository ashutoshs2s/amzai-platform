/**
 * The eight modules, in build order. SPEC.md section 2.
 *
 * All eight are listed in the rail whether or not they exist. A module that is
 * hidden until it is built gives an operator no idea what is coming; a module
 * that is listed but navigates nowhere is worse, because it looks broken. So
 * the ones without a screen are shown and visibly unavailable.
 *
 * `href` is the single source of availability: a module is reachable exactly
 * when it has somewhere to go. There is no separate `available` flag to fall
 * out of step with the routes that actually exist.
 */

export type Module = {
  /** Position in SPEC.md section 2. Shown in the rail. */
  order: number;
  name: string;
  /** Absent until the module has a screen. */
  href?: string;
  /** Why it is not available yet. Shown on hover. */
  note?: string;
  /**
   * Other paths belonging to this module. Creating a client is part of Clients
   * and Programs but does not live under /programs, and the rail must not go
   * blank while an operator is halfway through setting one up.
   */
  alsoUnder?: string[];
};

export const MODULES: Module[] = [
  { order: 1, name: "Clients and Programs", href: "/programs", alsoUnder: ["/clients"] },
  { order: 2, name: "Onboarding", href: "/question-sets" },
  { order: 3, name: "Delivery Operations", note: "Not built yet" },
  { order: 4, name: "Client Dashboards", note: "Not built yet" },
  { order: 5, name: "Audience and Data Ops", note: "Not built yet" },
  { order: 6, name: "Campaigns", note: "Not built yet" },
  { order: 7, name: "Commercial", note: "Not built yet" },
  { order: 8, name: "Logistics", note: "Not built yet" },
];

/** The module a path belongs to, for marking the rail. */
export function currentModule(pathname: string): Module | undefined {
  return MODULES.filter((m) => m.href).find((m) =>
    [m.href!, ...(m.alsoUnder ?? [])].some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    ),
  );
}
