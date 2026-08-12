"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/Button";
import { Field, Select, TextInput } from "@/components/form/Field";
import { createClientProgramme, type Assignment } from "@/lib/data/client-actions";
import {
  countsToMilestone,
  PROGRAMME_TYPE_LABEL,
  PROGRAMME_TYPES,
  ROLE_ON_PROGRAMME,
  ROLE_ON_PROGRAMME_LABEL,
} from "@/lib/programme-types";
import { NO_SUB_SEGMENT, type ClientType } from "@/lib/taxonomy";
import { slugify } from "@/lib/slug";

/**
 * New client. SPEC.md section 4, in that section's order.
 *
 * One screen rather than a wizard. The four steps are short, each depends on
 * the one above it, and an operator setting up a client wants to see the whole
 * thing at once rather than discover on step four that they need a date from
 * step two.
 *
 * It stops at the team on purpose. Generation is the next screen, because it
 * has a preview to approve and freezes what it writes.
 */

type Props = {
  clientTypes: ClientType[];
  staff: { id: string; name: string; role: string }[];
  modules: { slug: string; name: string; clientTypeId: string | null }[];
};

export function NewClientForm({ clientTypes, staff, modules }: Props) {
  const router = useRouter();

  const [organisationName, setOrganisationName] = useState("");
  const [clientTypeId, setClientTypeId] = useState("");
  const [subSegmentId, setSubSegmentId] = useState("");
  const [category, setCategory] = useState("");

  const [programmeName, setProgrammeName] = useState("");
  const [programmeType, setProgrammeType] = useState<string>("event");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [milestoneDate, setMilestoneDate] = useState("");
  const [gateDate, setGateDate] = useState("");

  const [chosenModules, setChosenModules] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const clientType = clientTypes.find((t) => t.id === clientTypeId);
  const subSegments = clientType?.subSegments ?? [];
  const toMilestone = countsToMilestone(programmeType);

  /*
    Offered from the same rows generation resolves against, filtered by the
    client type chosen above. Choosing a different type clears anything that no
    longer applies, rather than carrying a hidden choice into generation.
  */
  const availableModules = useMemo(
    () => modules.filter((m) => m.clientTypeId === null || m.clientTypeId === clientTypeId),
    [modules, clientTypeId],
  );

  function changeClientType(id: string) {
    setClientTypeId(id);
    setSubSegmentId("");
    const stillOffered = new Set(
      modules.filter((m) => m.clientTypeId === null || m.clientTypeId === id).map((m) => m.slug),
    );
    setChosenModules((current) => current.filter((slug) => stillOffered.has(slug)));
  }

  function addAssignment() {
    setAssignments((current) => [...current, { userId: "", role: "delivery_lead" }]);
  }

  const readyAssignments = assignments.filter((a) => a.userId !== "");

  async function submit() {
    setBusy(true);
    setMessage(null);
    setFieldErrors({});

    const result = await createClientProgramme({
      organisationName,
      clientTypeId,
      subSegmentId: subSegmentId || null,
      category,
      programmeName,
      programmeType,
      startDate,
      endDate,
      milestoneDate,
      gateDate,
      situationalSlugs: chosenModules,
      assignments: readyAssignments,
    });

    setBusy(false);
    if (result.ok) {
      // Straight to the preview: the sequence's last step, not a dead end on a
      // programme with no questions.
      router.push(`/programs/${result.programmeId}/generate`);
      return;
    }
    setMessage(result.message);
    setFieldErrors(result.fields ?? {});
  }

  const organisationSlug = slugify(organisationName);
  const programmeSlug = slugify(programmeName);

  return (
    <div className="max-w-[900px]">
      <Link href="/programs" className="rounded-base text-label text-accent underline underline-offset-2">
        Programs
      </Link>

      <h1 className="mt-2 text-page-title font-semibold text-ink">New client</h1>
      <p className="mt-1 max-w-[640px] text-body text-slate">
        The order matters. The organisation decides which questions the programme gets, and
        the team decides who they are assigned to, so both come before onboarding is
        generated. Nothing is written until you press Create.
      </p>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-8">
        <h2 className="border-b border-line pb-2 text-section font-semibold text-ink">1. The organisation</h2>

        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-5 rounded-base border border-line bg-surface p-4">
          <Field
            label="Organisation name"
            required
            error={fieldErrors.organisationName}
            hint={organisationSlug ? `Address: /${organisationSlug}` : undefined}
          >
            <TextInput
              value={organisationName}
              onChange={(e) => setOrganisationName(e.target.value)}
              autoComplete="off"
            />
          </Field>

          <Field label="Client type" required error={fieldErrors.clientTypeId}>
            <Select value={clientTypeId} onChange={(e) => changeClientType(e.target.value)}>
              <option value="">Choose…</option>
              {clientTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Sub-segment"
            hint={
              !clientTypeId
                ? "Choose a client type first."
                : subSegments.length === 0
                  ? `${clientType?.label} has no sub-segments.`
                  : undefined
            }
          >
            <Select
              value={subSegmentId}
              disabled={subSegments.length === 0}
              onChange={(e) => setSubSegmentId(e.target.value)}
            >
              <option value="">{subSegments.length === 0 ? NO_SUB_SEGMENT : "Choose…"}</option>
              {subSegments.map((segment) => (
                <option key={segment.id} value={segment.id}>
                  {segment.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Category"
            hint="Optional, and free text. Privileged Access Management, say."
          >
            <TextInput value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-8">
        <h2 className="border-b border-line pb-2 text-section font-semibold text-ink">2. The programme</h2>

        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-5 rounded-base border border-line bg-surface p-4">
          <Field
            label="Programme name"
            required
            error={fieldErrors.programmeName}
            hint={programmeSlug ? `Address: /${programmeSlug}` : undefined}
          >
            <TextInput
              value={programmeName}
              onChange={(e) => setProgrammeName(e.target.value)}
              autoComplete="off"
            />
          </Field>

          <Field label="Programme type" required error={fieldErrors.programmeType}>
            <Select value={programmeType} onChange={(e) => setProgrammeType(e.target.value)}>
              {PROGRAMME_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PROGRAMME_TYPE_LABEL[type]}
                </option>
              ))}
            </Select>
          </Field>

          {/*
            Only the dates the type actually uses. An event counts down to a
            fixed date; everything else runs in engagement weeks. SPEC.md 7.2.
          */}
          {toMilestone ? (
            <Field
              label="Milestone date"
              required
              error={fieldErrors.milestoneDate}
              hint="The date that does not move. The countdown reads from it."
            >
              <TextInput
                type="date"
                value={milestoneDate}
                onChange={(e) => setMilestoneDate(e.target.value)}
              />
            </Field>
          ) : (
            <>
              <Field label="Start date" required error={fieldErrors.startDate}>
                <TextInput
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Field>
              <Field label="End date" required error={fieldErrors.endDate}>
                <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
              <Field
                label="Gate date"
                error={fieldErrors.gateDate}
                hint="Optional. The engagement turns amber from here."
              >
                <TextInput type="date" value={gateDate} onChange={(e) => setGateDate(e.target.value)} />
              </Field>
            </>
          )}
        </div>

        {availableModules.length > 0 && (
          <div className="mt-4">
            <span className="text-label text-slate">Situational modules</span>
            <p className="mt-1 max-w-[560px] text-body text-slate">
              Optional and independent. They add their questions at generation, and anything
              they repeat is dropped there and listed.
            </p>
            <div className="mt-2 overflow-hidden rounded-base border border-line bg-surface">
              {availableModules.map((module) => (
                <label
                  key={module.slug}
                  className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 hover:bg-canvas"
                >
                  <input
                    type="checkbox"
                    checked={chosenModules.includes(module.slug)}
                    onChange={(e) =>
                      setChosenModules((current) =>
                        e.target.checked
                          ? [...current, module.slug]
                          : current.filter((s) => s !== module.slug),
                      )
                    }
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="text-body text-ink">{module.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-8">
        <h2 className="border-b border-line pb-2 text-section font-semibold text-ink">3. The team</h2>
        <p className="mt-1 max-w-[640px] text-body text-slate">
          At least one person. Onboarding questions are assigned by role, so who holds a role
          here decides who owes what. SPEC.md 4.2.
        </p>

        {assignments.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-base border border-line bg-surface">
            {assignments.map((assignment, index) => (
              <div
                key={index}
                className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
              >
                <Select
                  aria-label="Person"
                  value={assignment.userId}
                  onChange={(e) =>
                    setAssignments((current) =>
                      current.map((a, i) => (i === index ? { ...a, userId: e.target.value } : a)),
                    )
                  }
                >
                  <option value="">Choose somebody…</option>
                  {staff.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>

                <Select
                  aria-label="Role on the programme"
                  value={assignment.role}
                  onChange={(e) =>
                    setAssignments((current) =>
                      current.map((a, i) => (i === index ? { ...a, role: e.target.value } : a)),
                    )
                  }
                >
                  {ROLE_ON_PROGRAMME.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_ON_PROGRAMME_LABEL[role]}
                    </option>
                  ))}
                </Select>

                <Button
                  variant="quiet"
                  className="ml-auto"
                  onClick={() =>
                    setAssignments((current) => current.filter((_, i) => i !== index))
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3">
          <Button onClick={addAssignment}>Add someone</Button>
        </div>

        {fieldErrors.assignments && (
          <p className="mt-2 text-body text-critical">{fieldErrors.assignments}</p>
        )}

        {/*
          Two people in one role is not an error. It is settled at generation,
          by an admin, one question at a time. SPEC.md 4.4.
        */}
        {readyAssignments.length > 0 && (
          <p className="mt-2 text-body text-slate">
            {readyAssignments.length} assigned. Where two people share a role, generation asks
            who each set of questions goes to.
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {message && (
        <p className="mt-6 border border-critical rounded-base bg-critical-bg p-3 text-body text-critical">
          {message}
        </p>
      )}

      <div className="mt-6 flex items-center gap-3 border-t border-line pt-4">
        <Button
          variant="primary"
          disabled={busy || readyAssignments.length === 0}
          onClick={submit}
        >
          {busy ? "Creating…" : "Create and review onboarding"}
        </Button>
        <Link href="/programs" className="text-body text-accent hover:underline">
          Cancel
        </Link>
      </div>

      {/* A disabled button with no explanation is a dead end. DESIGN.md 5. */}
      {readyAssignments.length === 0 && (
        <p className="mt-2 text-body text-slate">
          Add at least one person to the team first. Without one, every onboarding question
          would generate with nobody against it.
        </p>
      )}
    </div>
  );
}
