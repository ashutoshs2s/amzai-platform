"use client";

import { useState } from "react";

import { Select } from "@/components/form/Field";
import {
  setManagedOrganisation,
  setUserActive,
  setUserFunction,
  setUserTier,
} from "@/lib/data/admin-actions";
import type { StaffFunction, StaffRow } from "@/lib/data/admin";
import {
  assignableTiers,
  canEditUser,
  isSuperAdmin,
  TIER_DESCRIPTION,
  TIER_LABEL,
  TIERS,
} from "@/lib/tiers";

/**
 * Staff and privileges.
 *
 * Three separate questions, kept visibly separate because conflating them is
 * what the four tiers were introduced to fix:
 *
 *   Tier          how many programmes a person sees
 *   Functions     which tables and columns they may touch within that
 *   Organisations which clients a manager holds
 *
 * The super admin row renders with every control inert rather than hidden. An
 * admin should be able to see that the row exists and that they cannot change
 * it; a row that vanished would look like a missing person.
 */

const NEVER_ASSIGNABLE = "super_admin";

export function AdminContent({
  actorTier,
  actorId,
  staff,
  functions,
  organisations,
}: {
  actorTier: string;
  actorId: string;
  staff: StaffRow[];
  functions: StaffFunction[];
  organisations: { id: string; name: string }[];
}) {
  const [rows, setRows] = useState(staff);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const offerable = assignableTiers(actorTier);

  function flash(userId: string) {
    setSaved(userId);
    setTimeout(() => setSaved((c) => (c === userId ? null : c)), 2000);
  }

  async function run(userId: string, apply: () => Promise<{ ok: boolean; message?: string }>,
                     optimistic: (row: StaffRow) => StaffRow) {
    const before = rows;
    setRows((current) => current.map((r) => (r.id === userId ? optimistic(r) : r)));
    setError(null);

    const result = await apply();
    if (!result.ok) {
      // Put it back. Showing a state the database refused would be a lie.
      setRows(before);
      setError({ id: userId, message: result.message ?? "That did not save." });
      return;
    }
    flash(userId);
  }

  return (
    <div className="max-w-[1500px]">
      <h1 className="text-page-title font-semibold text-ink">Staff and privileges</h1>
      <p className="mt-1 max-w-[760px] text-body text-slate">
        Three separate questions. The <span className="text-ink">tier</span> decides how many
        programmes somebody sees. A <span className="text-ink">function</span> decides which
        tables and columns they may touch within that. For a manager,{" "}
        <span className="text-ink">organisations</span> decides which clients they hold. None
        of these is the job somebody does on a programme, which is set on the programme
        itself.
      </p>

      <table className="mt-6 w-full table-fixed border border-line bg-surface">
        <thead>
          <tr className="border-b border-line text-left text-table-header uppercase tracking-wide text-slate">
            <th className="w-[22%] px-3 py-2 font-medium">Name</th>
            <th className="w-[16%] px-3 py-2 font-medium">Tier</th>
            <th className="px-3 py-2 font-medium">Functions</th>
            <th className="w-[20%] px-3 py-2 font-medium">Organisations</th>
            <th className="w-[10%] px-3 py-2 font-medium">Active</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((person) => {
            const locked = !canEditUser(actorTier, person.tier);
            const isSelf = person.id === actorId;

            return (
              <tr key={person.id} className="border-b border-line last:border-b-0 align-top">
                <td className="px-3 py-2">
                  <span className="block text-body text-ink">{person.fullName}</span>
                  <span className="block text-caption text-slate">{person.email}</span>
                  {saved === person.id && (
                    <span className="mt-1 block text-caption font-medium text-clear" role="status">
                      Saved
                    </span>
                  )}
                  {error?.id === person.id && (
                    <span className="mt-1 block text-caption text-critical" role="status">
                      {error.message}
                    </span>
                  )}
                </td>

                {/* Tier ------------------------------------------------- */}
                <td className="px-3 py-2">
                  {locked ? (
                    <span className="text-body text-ink">{TIER_LABEL[person.tier]}</span>
                  ) : (
                    <Select
                      quiet
                      aria-label={`Tier for ${person.fullName}`}
                      value={person.tier}
                      onChange={(event) => {
                        const tier = event.target.value;
                        run(
                          person.id,
                          () => setUserTier(person.id, tier),
                          (r) => ({ ...r, tier, organisations: tier === "manager" ? r.organisations : [] }),
                        );
                      }}
                    >
                      {TIERS.filter(
                        (t) => t !== NEVER_ASSIGNABLE && (offerable.includes(t) || t === person.tier),
                      ).map((tier) => (
                        <option key={tier} value={tier} disabled={!offerable.includes(tier)}>
                          {TIER_LABEL[tier]}
                        </option>
                      ))}
                    </Select>
                  )}
                  <span className="mt-1 block text-caption text-slate">
                    {TIER_DESCRIPTION[person.tier]}
                  </span>
                </td>

                {/* Functions -------------------------------------------- */}
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    {functions.map((fn) => {
                      const held = person.functionSlugs.includes(fn.slug);
                      return (
                        <label
                          key={fn.id}
                          className={`flex items-start gap-2 text-body ${
                            locked ? "text-mute" : "cursor-pointer text-ink"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={held}
                            disabled={locked}
                            onChange={(event) => {
                              const next = event.target.checked;
                              run(
                                person.id,
                                () => setUserFunction(person.id, fn.slug, next),
                                (r) => ({
                                  ...r,
                                  functionSlugs: next
                                    ? [...r.functionSlugs, fn.slug]
                                    : r.functionSlugs.filter((s) => s !== fn.slug),
                                }),
                              );
                            }}
                            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                          />
                          <span>
                            {fn.label}
                            {fn.description && (
                              <span className="block text-caption text-slate">{fn.description}</span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </td>

                {/* Organisations ---------------------------------------- */}
                <td className="px-3 py-2">
                  {person.tier !== "manager" ? (
                    <span className="text-caption text-slate">
                      {isSuperAdmin(person.tier) || person.tier === "admin"
                        ? "Every organisation, by tier."
                        : "Assigned programmes only."}
                    </span>
                  ) : (
                    <>
                      <span className="text-body text-ink">
                        {person.organisations.length === 0
                          ? "None yet"
                          : person.organisations.map((o) => o.name).join(", ")}
                      </span>
                      {person.organisations.length === 0 && (
                        <span className="mt-1 block text-caption text-watch">
                          A manager with no organisations sees only what they are assigned to.
                        </span>
                      )}
                      {!locked && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((c) => (c === person.id ? null : person.id))
                          }
                          className="mt-1 rounded-base text-caption text-accent underline underline-offset-2"
                        >
                          {expanded === person.id ? "Done" : "Change"}
                        </button>
                      )}
                      {expanded === person.id && (
                        <div className="mt-2 flex flex-col gap-1 border border-line rounded-base bg-canvas p-2">
                          {organisations.map((org) => {
                            const held = person.organisations.some((o) => o.id === org.id);
                            return (
                              <label
                                key={org.id}
                                className="flex cursor-pointer items-center gap-2 text-body text-ink"
                              >
                                <input
                                  type="checkbox"
                                  checked={held}
                                  onChange={(event) => {
                                    const next = event.target.checked;
                                    run(
                                      person.id,
                                      () => setManagedOrganisation(person.id, org.id, next),
                                      (r) => ({
                                        ...r,
                                        organisations: next
                                          ? [...r.organisations, org]
                                          : r.organisations.filter((o) => o.id !== org.id),
                                      }),
                                    );
                                  }}
                                  className="h-4 w-4 accent-[var(--accent)]"
                                />
                                {org.name}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </td>

                {/* Active ----------------------------------------------- */}
                <td className="px-3 py-2">
                  <label
                    className={`flex items-center gap-2 text-body ${
                      locked ? "text-mute" : "cursor-pointer text-ink"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={person.active}
                      disabled={locked}
                      onChange={(event) => {
                        const next = event.target.checked;
                        run(
                          person.id,
                          () => setUserActive(person.id, next),
                          (r) => ({ ...r, active: next }),
                        );
                      }}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    {person.active ? "Active" : "Inactive"}
                  </label>
                  {isSelf && !locked && (
                    <span className="mt-1 block text-caption text-watch">
                      This is you. Deactivating yourself signs you out.
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/*
        Said once, plainly, rather than as a disabled control the reader has to
        interpret. DESIGN.md section 5: a disabled control with no explanation
        is a dead end.
      */}
      <p className="mt-3 max-w-[760px] text-body text-slate">
        The super admin cannot be changed here, or anywhere. Not demoted, not deactivated,
        not deleted, by anyone including themselves — the database refuses it, not just this
        screen. Changing who it is takes a migration. Nobody can be given a tier at or above
        their own, and super admin is offered to nobody.
      </p>
    </div>
  );
}
