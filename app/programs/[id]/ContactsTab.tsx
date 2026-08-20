"use client";

import { useState } from "react";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field, TextInput } from "@/components/form/Field";
import {
  addClientContact,
  renameClientContact,
  setClientContactActive,
} from "@/lib/data/contact-actions";
import type { ClientContact } from "@/lib/data/contacts";
import { formatDayMonth } from "@/lib/time";

/**
 * Who at the client answers.
 *
 * Naming somebody here creates no account, ever. It records an address that may
 * later be sent a one-time link, and it is the list that link requests are
 * checked against — an address not on it gets no link and, deliberately, no
 * hint that it is not on it.
 */
/**
 * What the last link actually did.
 *
 * "Link sent" used to be printed from the request row existing, which said only
 * that a link was issued. A send that failed read identically to one that
 * arrived, so the client waited and Amzai believed it had gone. Each state now
 * says which it was, and the two failures are named apart because they need
 * different people to act: nobody configured a mail provider, or the provider
 * refused this message.
 */
function sendState(contact: ClientContact): { text: string; tone: string } | null {
  if (!contact.lastRequestedAt) return null;

  const when = formatDayMonth(contact.lastRequestedAt);

  switch (contact.lastSendStatus) {
    case "sent":
      return {
        text: `Link sent ${when}${contact.lastConsumedAt ? ", used" : ", unused"}`,
        tone: "text-slate",
      };
    case "failed":
      return {
        text: `Link NOT sent ${when} — the mail provider refused it${
          contact.lastSendDetail ? ` (${contact.lastSendDetail})` : ""
        }`,
        tone: "text-critical",
      };
    case "not_configured":
      return {
        text: `Link NOT sent ${when} — no mail provider is configured`,
        tone: "text-critical",
      };
    default:
      /*
        pending, or a row written before this was recorded. Deliberately not
        "sent": assuming success is the mistake this exists to correct.
      */
      return {
        text: `Link issued ${when}, delivery unknown`,
        tone: "text-watch",
      };
  }
}

export function ContactsTab({
  programmeId,
  contacts,
  canEdit,
}: {
  programmeId: string;
  contacts: ClientContact[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState(contacts);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const [seen, setSeen] = useState(contacts);
  if (contacts !== seen) {
    setSeen(contacts);
    setRows(contacts);
  }

  async function add() {
    setBusy(true);
    setError(null);
    const result = await addClientContact(programmeId, name, email);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setName("");
    setEmail("");
    // The server sends the real row back on refresh; this keeps the form usable
    // in the meantime without inventing an id.
    location.reload();
  }

  async function toggle(contact: ClientContact) {
    const next = !contact.active;
    setRows((current) =>
      current.map((c) => (c.id === contact.id ? { ...c, active: next } : c)),
    );
    setRowError(null);
    const result = await setClientContactActive(programmeId, contact.id, next);
    if (!result.ok) {
      setRows((current) =>
        current.map((c) => (c.id === contact.id ? { ...c, active: !next } : c)),
      );
      setRowError({ id: contact.id, message: result.message });
    }
  }

  async function rename(contact: ClientContact, value: string) {
    const trimmed = value.trim();
    if (trimmed === contact.name || trimmed === "") return;
    const before = contact.name;
    setRows((current) =>
      current.map((c) => (c.id === contact.id ? { ...c, name: trimmed } : c)),
    );
    const result = await renameClientContact(programmeId, contact.id, trimmed);
    if (!result.ok) {
      setRows((current) =>
        current.map((c) => (c.id === contact.id ? { ...c, name: before } : c)),
      );
      setRowError({ id: contact.id, message: result.message });
    }
  }

  return (
    <div className="mt-7">
      <p className="max-w-[640px] text-body text-slate">
        The people at the client who answer onboarding. Naming somebody here creates no
        account and no password: they are sent a one-time link when you ask for one. An
        address not on this list can request a link and will never receive one.
      </p>

      {rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState message="Nobody named yet. Add whoever at the client will answer." />
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-base border border-line bg-surface">
          <div className="flex items-baseline gap-3 border-b border-line bg-surface-head px-3 py-2">
            <span className="text-section font-semibold text-ink">Contacts</span>
            <span className="ml-auto font-time text-caption font-medium text-slate">
              {rows.filter((c) => c.active).length}/{rows.length}
            </span>
          </div>

          {rows.map((contact) => (
            <div key={contact.id} className="border-b border-line px-3 py-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {canEdit ? (
                  <input
                    defaultValue={contact.name}
                    aria-label={`Name of ${contact.email}`}
                    onBlur={(event) => rename(contact, event.target.value)}
                    className={`h-6 rounded-base border border-transparent bg-transparent px-1 text-body transition-colors hover:border-line hover:bg-surface focus:border-accent focus:bg-surface ${
                      contact.active ? "text-ink" : "text-slate"
                    }`}
                  />
                ) : (
                  <span className={contact.active ? "text-body text-ink" : "text-body text-slate"}>
                    {contact.name}
                  </span>
                )}

                <span className="text-body text-slate">{contact.email}</span>

                {!contact.active && (
                  <span className="text-caption text-slate">Inactive</span>
                )}

                <span className="ml-auto flex items-center gap-3">
                  {(() => {
                    const state = sendState(contact);
                    return state ? (
                      <span className={`text-caption ${state.tone}`}>{state.text}</span>
                    ) : null;
                  })()}
                  {canEdit && (
                    <Button variant="quiet" onClick={() => toggle(contact)}>
                      {contact.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  )}
                </span>
              </div>

              {rowError?.id === contact.id && (
                <p className="mt-1 text-caption text-critical" role="status">
                  {rowError.message}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <section className="mt-8">
          <h3 className="border-b border-line pb-2 text-section font-semibold text-ink">
            Add a contact
          </h3>
          <div className="mt-3 flex flex-wrap items-end gap-4 rounded-base border border-line bg-surface p-4">
            <Field label="Name" required className="w-[220px]">
              <TextInput
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="Email" required className="w-[280px]">
              <TextInput
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="off"
              />
            </Field>
            <Button variant="primary" disabled={busy} onClick={add}>
              {busy ? "Adding…" : "Add contact"}
            </Button>
          </div>
          {error && <p className="mt-2 text-body text-critical">{error}</p>}
        </section>
      )}

      {/*
        Deactivating rather than deleting, said where the control is. An answer
        whose author has vanished is worse than one whose author has left.
      */}
      <p className="mt-3 max-w-[640px] text-body text-slate">
        Deactivating stops a contact requesting a link or answering anything. Answers they
        already gave keep naming them, which is why there is no delete here.
      </p>

      {rows.some((c) => c.lastSendStatus === "failed" || c.lastSendStatus === "not_configured") && (
        <p className="mt-2 max-w-[640px] text-body text-critical">
          A link that was not sent is still valid — the client simply never received it.
          Fix the mail setup and ask them to request another.
        </p>
      )}
    </div>
  );
}
