import { type VerticalId, subVerticalLabel, verticalLabel } from "@/lib/verticals";

/**
 * Hard-coded sample programmes.
 *
 * Stands in for the query this screen will eventually run. Nothing here touches
 * a database, and this file is deleted the moment module 1 has real data.
 *
 * The four count flags — atRisk, hasBlocked, awaitingClient — are stored on the
 * row rather than derived, because deriving them needs onboarding responses,
 * which do not exist yet. Their real definitions are in SPEC.md section 7.3:
 *
 *   at risk         has a blocking response, past its due date, not approved
 *   blocked         has a response with status `blocked`
 *   awaiting client has a client-owned response that is not approved
 *
 * When the real query arrives these three fields disappear and the counts are
 * computed. The screen above them does not change.
 */

export type ProgrammeStatus = "onboarding" | "active" | "paused" | "complete";

export type Programme = {
  id: string;
  name: string;
  vertical: VerticalId;
  /** Slug, not a label. Null for Law Firms, which is not subdivided. */
  subVertical: string | null;
  type: "Event" | "Retainer" | "Dedicated team" | "Series" | "Research";
  owner: string;
  blocking: number;
  status: ProgrammeStatus;
  /** Days from today to the date that matters. Drives the default sort. */
  urgencyDays: number;
  atRisk: boolean;
  hasBlocked: boolean;
  awaitingClient: boolean;
  time:
    | { kind: "event"; milestoneOffset: number }
    | {
        kind: "retainer";
        startOffset: number;
        endOffset: number;
        gateOffset: number | null;
      };
};

export const SAMPLE_PROGRAMMES: Programme[] = [
  {
    id: "pr-1",
    name: "Identity Governance Leadership Forum",
    vertical: "b2b_tech",
    subVertical: "identity_access",
    type: "Event",
    owner: "Priya Raman",
    blocking: 2,
    status: "active",
    urgencyDays: -9,
    atRisk: true,
    hasBlocked: false,
    awaitingClient: false,
    time: { kind: "event", milestoneOffset: -9 },
  },
  {
    id: "pr-2",
    name: "Cloud Cost Control Executive Dinner",
    vertical: "b2b_tech",
    subVertical: "cloud_infrastructure",
    type: "Event",
    owner: "Daniel Okoro",
    blocking: 1,
    status: "active",
    urgencyDays: 3,
    atRisk: false,
    hasBlocked: true,
    awaitingClient: false,
    time: { kind: "event", milestoneOffset: 3 },
  },
  {
    id: "pr-3",
    name: "Private Client Partners Briefing",
    vertical: "law_firms",
    subVertical: null,
    type: "Event",
    owner: "Sana Iqbal",
    blocking: 3,
    status: "onboarding",
    urgencyDays: 12,
    atRisk: true,
    hasBlocked: true,
    awaitingClient: true,
    time: { kind: "event", milestoneOffset: 12 },
  },
  {
    id: "pr-4",
    name: "Exhibitor Acquisition Series",
    vertical: "conference_organizers",
    subVertical: "trade_show_organizers",
    type: "Series",
    owner: "Daniel Okoro",
    blocking: 1,
    status: "paused",
    urgencyDays: 31,
    atRisk: false,
    hasBlocked: false,
    awaitingClient: false,
    time: { kind: "event", milestoneOffset: 31 },
  },
  {
    id: "pr-5",
    name: "Managed Detection Demand Programme",
    vertical: "b2b_tech",
    subVertical: "cybersecurity",
    type: "Retainer",
    owner: "Tom Whitfield",
    blocking: 0,
    status: "active",
    urgencyDays: 46,
    atRisk: false,
    hasBlocked: false,
    awaitingClient: false,
    // Week 7 of 13, past the gate.
    time: {
      kind: "retainer",
      startOffset: -45,
      endOffset: 46,
      gateOffset: -3,
    },
  },
  {
    id: "pr-6",
    name: "Data Platform Buyer Intelligence",
    vertical: "b2b_tech",
    subVertical: "data_analytics",
    type: "Event",
    owner: "Priya Raman",
    blocking: 0,
    status: "onboarding",
    urgencyDays: 47,
    atRisk: false,
    hasBlocked: false,
    awaitingClient: true,
    time: { kind: "event", milestoneOffset: 47 },
  },
  {
    id: "pr-7",
    name: "Membership Growth Dedicated Team",
    vertical: "conference_organizers",
    subVertical: "associations",
    type: "Dedicated team",
    owner: "Ana Beltrán",
    blocking: 0,
    status: "active",
    urgencyDays: 74,
    atRisk: false,
    hasBlocked: false,
    awaitingClient: true,
    // Week 2 of 12, well before the gate.
    time: {
      kind: "retainer",
      startOffset: -10,
      endOffset: 74,
      gateOffset: 40,
    },
  },
];

export const OWNERS = [
  "Ana Beltrán",
  "Daniel Okoro",
  "Priya Raman",
  "Sana Iqbal",
  "Tom Whitfield",
];

export const PROGRAMME_TYPES = [
  "Event",
  "Retainer",
  "Dedicated team",
  "Series",
  "Research",
];

/* ===========================================================================
   Programme detail. DESIGN.md section 6.2.

   Same hard-coded stand-in as the list above. `onboarding: null` means
   onboarding has not been generated yet, which is what puts the Onboarding tab
   into its empty state and the generate gate from SPEC.md section 4.2 on
   screen.
   =========================================================================== */

export type ResponseStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "approved"
  | "blocked"
  | "na";

export type OnboardingField = {
  id: string;
  section: string;
  question: string;
  guidance?: string;
  response: string;
  /** The party responsible. Distinct from the assignee, who is a person. */
  owner: "client" | "amzai" | "both";
  /** Null shows as Unassigned and feeds the unassigned count. */
  assignee: string | null;
  dueOffset: number;
  status: ResponseStatus;
  blocking: boolean;
  answeredBy?: { name: string; party: "client" | "amzai"; dayOffset: number };
};

export type TeamMember = {
  name: string;
  roleOnProgram: string;
  allocationPercent: number;
};

export type AuditEntry = { dayOffset: number; text: string };

export type ProgrammeDetail = {
  approverName: string;
  approverEmail: string;
  nextMilestone: { label: string; dayOffset: number };
  team: TeamMember[];
  /** Null means onboarding has not been generated. */
  onboarding: OnboardingField[] | null;
  templateName: string;
  audit: AuditEntry[];
};

const IDENTITY_ONBOARDING: OnboardingField[] = [
  {
    id: "f1",
    section: "Audience",
    question: "Which job titles should we target?",
    guidance: "Seniority matters more than headcount. Be specific.",
    response:
      "CISO, Head of Identity, IAM Architect. Financial services and insurance only.",
    owner: "client",
    assignee: "Priya Raman",
    dueOffset: -18,
    status: "approved",
    blocking: false,
    answeredBy: { name: "Rachel Okonjo", party: "client", dayOffset: -19 },
  },
  {
    id: "f2",
    section: "Audience",
    question: "Which companies are off limits?",
    guidance: "Existing customers, live opportunities, competitors.",
    response: "Full suppression list sent 4 August. 212 domains.",
    owner: "client",
    assignee: "Daniel Okoro",
    dueOffset: -14,
    status: "approved",
    blocking: false,
    answeredBy: { name: "Rachel Okonjo", party: "client", dayOffset: -15 },
  },
  {
    id: "f3",
    section: "Audience",
    question: "Minimum company size?",
    response: "",
    owner: "client",
    assignee: null,
    dueOffset: -3,
    status: "not_started",
    blocking: false,
  },
  {
    id: "f4",
    section: "Content",
    question: "Who is speaking, and what is their title?",
    guidance: "Full name and title as they should appear on the invitation.",
    response: "Confirmed: Dr Amara Nwosu, Chief Identity Architect.",
    owner: "amzai",
    assignee: "Priya Raman",
    dueOffset: -6,
    status: "approved",
    blocking: false,
    answeredBy: { name: "Priya Raman", party: "amzai", dayOffset: -7 },
  },
  {
    id: "f5",
    section: "Content",
    question: "Three discussion questions for the roundtable",
    response: "Draft with the client. Two agreed, third still open.",
    owner: "both",
    assignee: "Sana Iqbal",
    dueOffset: -1,
    status: "in_progress",
    blocking: false,
    answeredBy: { name: "Sana Iqbal", party: "amzai", dayOffset: -2 },
  },
  {
    id: "f6",
    section: "Content",
    question: "Approved copy for the invitation email",
    response: "",
    owner: "client",
    assignee: "Sana Iqbal",
    dueOffset: -4,
    status: "blocked",
    blocking: true,
  },
  {
    id: "f7",
    section: "Logistics",
    question: "Final attendee list",
    guidance: "Names, titles and dietary requirements.",
    response: "",
    owner: "client",
    assignee: "Daniel Okoro",
    dueOffset: -2,
    status: "submitted",
    blocking: true,
    answeredBy: { name: "Marcus Feld", party: "client", dayOffset: -2 },
  },
  {
    id: "f8",
    section: "Logistics",
    question: "Venue and room set-up",
    response: "The Ned, private dining room. Confirmed 1 August.",
    owner: "amzai",
    assignee: "Priya Raman",
    dueOffset: -9,
    status: "approved",
    blocking: false,
    answeredBy: { name: "Priya Raman", party: "amzai", dayOffset: -10 },
  },
  {
    id: "f9",
    section: "Logistics",
    question: "Dietary requirements collected?",
    response: "Not applicable for this format.",
    owner: "amzai",
    assignee: null,
    dueOffset: 2,
    status: "na",
    blocking: false,
  },
];

const LAW_FIRM_ONBOARDING: OnboardingField[] = [
  {
    id: "g1",
    section: "Audience",
    question: "Which practice areas are in scope?",
    response: "Private client and family. Not corporate.",
    owner: "client",
    assignee: "Sana Iqbal",
    dueOffset: -5,
    status: "approved",
    blocking: false,
    answeredBy: { name: "Helena Vaughan", party: "client", dayOffset: -6 },
  },
  {
    id: "g2",
    section: "Audience",
    question: "Target partner seniority",
    response: "",
    owner: "client",
    assignee: null,
    dueOffset: -1,
    status: "blocked",
    blocking: true,
  },
  {
    id: "g3",
    section: "Content",
    question: "Signed-off briefing agenda",
    response: "",
    owner: "both",
    assignee: "Sana Iqbal",
    dueOffset: 1,
    status: "not_started",
    blocking: true,
  },
  {
    id: "g4",
    section: "Logistics",
    question: "Confirmed date and venue",
    response: "",
    owner: "amzai",
    assignee: "Sana Iqbal",
    dueOffset: 3,
    status: "in_progress",
    blocking: true,
  },
];

export const SAMPLE_DETAILS: Record<string, ProgrammeDetail> = {
  "pr-1": {
    approverName: "Rachel Okonjo",
    approverEmail: "rachel.okonjo@kestrel.example",
    nextMilestone: { label: "Invitations live", dayOffset: -2 },
    team: [
      { name: "Priya Raman", roleOnProgram: "delivery_lead", allocationPercent: 40 },
      { name: "Daniel Okoro", roleOnProgram: "specialist", allocationPercent: 25 },
      { name: "Sana Iqbal", roleOnProgram: "specialist", allocationPercent: 20 },
    ],
    onboarding: IDENTITY_ONBOARDING,
    templateName: "B2B Tech event, v3",
    audit: [
      { dayOffset: -1, text: "Sana Iqbal changed Three discussion questions to In progress" },
      { dayOffset: -2, text: "Marcus Feld submitted Final attendee list" },
      { dayOffset: -4, text: "Priya Raman flagged Approved copy for the invitation email as Blocked" },
      { dayOffset: -7, text: "Priya Raman approved Who is speaking, and what is their title?" },
      { dayOffset: -10, text: "Priya Raman approved Venue and room set-up" },
      { dayOffset: -12, text: "Daniel Okoro was assigned as specialist" },
      { dayOffset: -15, text: "Rachel Okonjo answered Which companies are off limits?" },
      { dayOffset: -19, text: "Rachel Okonjo answered Which job titles should we target?" },
      { dayOffset: -22, text: "Priya Raman generated onboarding from B2B Tech event, v3" },
      { dayOffset: -22, text: "Priya Raman was assigned as delivery lead" },
      { dayOffset: -24, text: "Sana Iqbal created the programme" },
    ],
  },
  "pr-3": {
    approverName: "Helena Vaughan",
    approverEmail: "h.vaughan@bramwell.example",
    nextMilestone: { label: "Onboarding due", dayOffset: 3 },
    team: [
      { name: "Sana Iqbal", roleOnProgram: "delivery_lead", allocationPercent: 30 },
    ],
    onboarding: LAW_FIRM_ONBOARDING,
    templateName: "Law Firms event, v2",
    audit: [
      { dayOffset: -1, text: "Sana Iqbal set Target partner seniority to Blocked" },
      { dayOffset: -3, text: "Sana Iqbal generated onboarding from Law Firms event, v2" },
      { dayOffset: -3, text: "Sana Iqbal was assigned as delivery lead" },
      { dayOffset: -4, text: "Helena Vaughan was added as a client contact" },
      { dayOffset: -6, text: "Priya Raman created the programme" },
    ],
  },
};

/** Programmes with no team assigned. Generation is blocked. SPEC.md 4.2. */
const NO_TEAM = new Set(["pr-6"]);

export function detailFor(programme: Programme): ProgrammeDetail {
  const known = SAMPLE_DETAILS[programme.id];
  if (known) return known;

  return {
    approverName: "Not set",
    approverEmail: "",
    nextMilestone: { label: "Onboarding due", dayOffset: 7 },
    team: NO_TEAM.has(programme.id)
      ? []
      : [{ name: programme.owner, roleOnProgram: "delivery_lead", allocationPercent: 30 }],
    onboarding: null,
    templateName: "B2B Tech event, v3",
    audit: [
      { dayOffset: -2, text: `${programme.owner} was assigned as delivery lead` },
      { dayOffset: -5, text: "Priya Raman created the programme" },
    ],
  };
}

/* ===========================================================================
   Stand-ins for things that need authentication or a query.
   =========================================================================== */

/**
 * The signed-in operator. There is no auth yet, so the top bar needs somebody
 * to be. Replaced by the Supabase session when module 1 has real users.
 */
export const CURRENT_USER = "Sana Iqbal";

export type AwaitingSummary = {
  count: number;
  overdue: number;
  dueSoon: number;
};

/**
 * The awaiting-me count. SPEC.md section 7.3: onboarding responses assigned to
 * the signed-in user whose status is neither approved nor N/A, across every
 * programme they can see.
 *
 * Overdue and due-soon are split out because the top bar colours the count by
 * urgency, and a number that is permanently amber stops being read.
 */
export function awaitingFor(name: string): AwaitingSummary {
  let count = 0;
  let overdue = 0;
  let dueSoon = 0;

  for (const programme of SAMPLE_PROGRAMMES) {
    for (const field of detailFor(programme).onboarding ?? []) {
      if (field.assignee !== name) continue;
      if (field.status === "approved" || field.status === "na") continue;
      count += 1;
      if (field.dueOffset < 0) overdue += 1;
      else if (field.dueOffset <= 7) dueSoon += 1;
    }
  }

  return { count, overdue, dueSoon };
}

/**
 * Programmes matching a search term, for the top bar.
 *
 * Matches the things an operator actually half-remembers: the name, who owns
 * it, what kind of work it is, and the market it sits in. Searching
 * "cybersecurity" and getting nothing because the word only appears in a
 * column the search ignores is worse than no search.
 */
export function searchProgrammes(term: string): Programme[] {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  return SAMPLE_PROGRAMMES.filter((p) =>
    [
      p.name,
      p.owner,
      p.type,
      verticalLabel(p.vertical),
      subVerticalLabel(p.subVertical) ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(q),
  ).slice(0, 6);
}
