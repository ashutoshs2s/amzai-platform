import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ClientType } from "@/lib/taxonomy";

/**
 * The client taxonomy, read from the database.
 *
 * This replaced lib/verticals.ts, which held the list in TypeScript. The point
 * of the move is that an admin can add a sub-segment without a deploy, so
 * nothing here may hard-code a value: labels, order and which segments exist
 * all come from the rows.
 *
 * Level two, the category, is deliberately absent. It is free text on the
 * organisation and has no list to read.
 */

export type { ClientType, SubSegment } from "@/lib/taxonomy";

export async function listClientTypes(): Promise<ClientType[]> {
  const supabase = await createClient();

  const [{ data: types, error: typesError }, { data: segments, error: segError }] =
    await Promise.all([
      supabase
        .from("client_types")
        .select("id, slug, label")
        .eq("active", true)
        .order("sort_order"),
      supabase
        .from("client_sub_segments")
        .select("id, slug, label, client_type_id")
        .eq("active", true)
        .order("sort_order"),
    ]);

  if (typesError) throw new Error(`Could not load client types: ${typesError.message}`);
  if (segError) throw new Error(`Could not load sub-segments: ${segError.message}`);

  return (types ?? []).map((type) => ({
    id: type.id,
    slug: type.slug,
    label: type.label,
    subSegments: (segments ?? [])
      .filter((s) => s.client_type_id === type.id)
      .map((s) => ({ id: s.id, slug: s.slug, label: s.label })),
  }));
}
