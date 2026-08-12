"use client";

import { useState } from "react";

import { Button } from "@/components/Button";
import { DestructiveConfirm } from "@/components/form/DestructiveConfirm";
import type { ClientRow } from "@/lib/data/admin";
import {
  deleteClient,
  deleteProgramme,
  setClientArchived,
  setProgrammeArchived,
} from "@/lib/data/admin-actions";

/**
 * Clients and programmes: archive, and rarely delete.
 *
 * Archive is the normal action and reads as such. Delete is offered only where
 * the database would allow it — a programme with no generated onboarding, an
 * organisation with no programmes — and where it is not, the reason is written
 * out rather than shown as a disabled button. DESIGN.md section 5.
 */
export function ClientsSection({ clients }: { clients: ClientRow[] }) {
  const [rows, setRows] = useState(clients);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<{ id: string; text: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const visible = showArchived ? rows : rows.filter((c) => c.archivedAt === null);

  async function run(id: string, apply: () => Promise<{ ok: boolean; message?: string }>) {
    setMessage(null);
    const result = await apply();
    if (!result.ok) {
      setMessage({ id, text: result.message ?? "That did not work." });
      return false;
    }
    return true;
  }

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-section font-semibold text-ink">Clients and programmes</h2>
        <label className="flex cursor-pointer items-center gap-2 text-body text-slate">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Show archived
        </label>
      </div>

      <p className="mt-1 max-w-[760px] text-body text-slate">
        Archiving hides something from the interface and leaves its history whole. It is
        reversible. Deleting is not, and is refused wherever it would destroy a record of
        what happened.
      </p>

      <div className="mt-4 border border-line rounded-base bg-surface">
        {visible.length === 0 && (
          <p className="px-3 py-3 text-body text-slate">No clients yet.</p>
        )}

        {visible.map((client) => {
          const canDelete = client.programmeCount === 0;
          return (
            <div key={client.id} className="border-b border-line px-3 py-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-body font-medium text-ink">{client.name}</span>
                {client.archivedAt && (
                  <span className="text-caption text-slate">Archived</span>
                )}
                <span className="text-caption text-slate">
                  {client.programmeCount} programme{client.programmeCount === 1 ? "" : "s"}
                </span>

                <span className="ml-auto flex items-center gap-2">
                  <Button
                    variant="quiet"
                    onClick={async () => {
                      const next = client.archivedAt === null;
                      if (await run(client.id, () => setClientArchived(client.id, next))) {
                        setRows((current) =>
                          current.map((c) =>
                            c.id === client.id
                              ? {
                                  ...c,
                                  archivedAt: next ? new Date().toISOString() : null,
                                  programmes: next
                                    ? c.programmes.map((p) => ({
                                        ...p,
                                        archivedAt: p.archivedAt ?? new Date().toISOString(),
                                      }))
                                    : c.programmes,
                                }
                              : c,
                          ),
                        );
                      }
                    }}
                  >
                    {client.archivedAt ? "Unarchive" : "Archive"}
                  </Button>

                  {canDelete && (
                    <Button
                      variant="quiet"
                      onClick={() =>
                        setConfirming((c) => (c === client.id ? null : client.id))
                      }
                    >
                      Delete
                    </Button>
                  )}
                </span>
              </div>

              {!canDelete && (
                <p className="mt-1 text-caption text-slate">
                  Cannot be deleted while it has programmes, archived ones included. Archive
                  it instead.
                </p>
              )}

              {confirming === client.id && (
                <DestructiveConfirm
                  className="mt-2"
                  description={`Deleting ${client.name} removes the client permanently. This cannot be undone.`}
                  confirmPhrase={client.name}
                  actionLabel="Delete this client"
                  onCancel={() => setConfirming(null)}
                  onConfirm={async () => {
                    if (await run(client.id, () => deleteClient(client.id, client.name))) {
                      setRows((current) => current.filter((c) => c.id !== client.id));
                      setConfirming(null);
                    }
                  }}
                />
              )}

              {client.programmes.length > 0 && (
                <div className="mt-2 flex flex-col gap-1 border-l-2 border-l-line pl-3">
                  {client.programmes.map((programme) => (
                    <div key={programme.id} className="flex flex-wrap items-baseline gap-x-3">
                      <span className="text-body text-ink">{programme.name}</span>
                      {programme.archivedAt && (
                        <span className="text-caption text-slate">Archived</span>
                      )}
                      {programme.generated && (
                        <span className="text-caption text-slate">Onboarding generated</span>
                      )}

                      <span className="ml-auto flex items-center gap-2">
                        <Button
                          variant="quiet"
                          onClick={async () => {
                            const next = programme.archivedAt === null;
                            if (
                              await run(programme.id, () =>
                                setProgrammeArchived(programme.id, next),
                              )
                            ) {
                              setRows((current) =>
                                current.map((c) => ({
                                  ...c,
                                  programmes: c.programmes.map((p) =>
                                    p.id === programme.id
                                      ? {
                                          ...p,
                                          archivedAt: next ? new Date().toISOString() : null,
                                        }
                                      : p,
                                  ),
                                })),
                              );
                            }
                          }}
                        >
                          {programme.archivedAt ? "Unarchive" : "Archive"}
                        </Button>

                        {!programme.generated && (
                          <Button
                            variant="quiet"
                            onClick={() =>
                              setConfirming((c) => (c === programme.id ? null : programme.id))
                            }
                          >
                            Delete
                          </Button>
                        )}
                      </span>

                      {programme.generated && (
                        <p className="w-full text-caption text-slate">
                          Cannot be deleted: its answers are the record of what the client was
                          asked and said. Archive it instead.
                        </p>
                      )}

                      {confirming === programme.id && (
                        <div className="w-full">
                          <DestructiveConfirm
                            className="mt-2"
                            description={`Deleting ${programme.name} removes the programme permanently. This cannot be undone.`}
                            confirmPhrase={programme.name}
                            actionLabel="Delete this programme"
                            onCancel={() => setConfirming(null)}
                            onConfirm={async () => {
                              if (
                                await run(programme.id, () =>
                                  deleteProgramme(programme.id, programme.name),
                                )
                              ) {
                                setRows((current) =>
                                  current.map((c) => ({
                                    ...c,
                                    programmeCount:
                                      c.programmeCount -
                                      (c.programmes.some((p) => p.id === programme.id) ? 1 : 0),
                                    programmes: c.programmes.filter((p) => p.id !== programme.id),
                                  })),
                                );
                                setConfirming(null);
                              }
                            }}
                          />
                        </div>
                      )}

                      {message?.id === programme.id && (
                        <p className="w-full text-caption text-critical" role="status">
                          {message.text}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {message?.id === client.id && (
                <p className="mt-1 text-caption text-critical" role="status">
                  {message.text}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
