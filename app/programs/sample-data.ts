import type { VerticalId } from "@/lib/verticals";

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
