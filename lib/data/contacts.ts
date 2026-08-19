import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Client contacts: who at the client answers.
 *
 * Staff-side and unremarkable. It reads and writes through the authenticated
 * server client, so row level security scopes it to programmes the reader can
 * see and the audit trigger records them by auth.uid(). The service-role
 * identity problem belongs only to the client-facing routes, which have no
 * auth.uid() at all.
 *
 * A contact is not an account. SPEC.md 5 and CLAUDE.md rule 5: naming somebody
 * here creates no Supabase Auth user and no password, and never will. It
 * records an address Amzai may later send a one-time link to.
 */

export type ClientContact = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  /** When a link was last sent to them, or null. */
  lastRequestedAt: string | null;
  /** Whether that link has been used. */
  lastConsumedAt: string | null;
};

export async function listClientContacts(programmeId: string): Promise<ClientContact[]> {
  const supabase = await createClient();

  const [{ data: contacts, error }, { data: requests }] = await Promise.all([
    supabase
      .from("client_contacts")
      .select("id, name, email, active")
      .eq("program_id", programmeId)
      .order("name"),
    supabase
      .from("client_link_requests")
      .select("client_contact_id, created_at, consumed_at")
      .eq("program_id", programmeId)
      .order("created_at", { ascending: false }),
  ]);

  if (error) throw new Error(`Could not load the client contacts: ${error.message}`);

  return (contacts ?? []).map((contact) => {
    const latest = (requests ?? []).find((r) => r.client_contact_id === contact.id);
    return {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      active: contact.active,
      lastRequestedAt: latest?.created_at ?? null,
      lastConsumedAt: latest?.consumed_at ?? null,
    };
  });
}
