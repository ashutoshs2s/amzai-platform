import { ProgramsContent } from "./ProgramsContent";

/**
 * Programme list. DESIGN.md section 6.1.
 *
 * The default landing screen once there is an app shell to land in. Built
 * against hard-coded sample data; no database, no queries.
 *
 * The clock is read here and passed down as a fixed instant, so a countdown
 * renders identically on the server and on the client.
 */
export const dynamic = "force-dynamic";

export default function ProgramsPage() {
  return <ProgramsContent nowIso={new Date().toISOString()} />;
}
