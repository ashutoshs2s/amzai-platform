import type { PrivilegeChange } from "@/lib/data/admin";
import { formatDayMonthYear } from "@/lib/time";

/**
 * Who changed a tier, a function or an organisation assignment, and when.
 *
 * Read from audit_events, which is append-only and written by a database
 * trigger rather than by the screen that made the change. So a change made in
 * the SQL editor, or by a script, appears here exactly the same way — which is
 * the only version of this worth having.
 *
 * A server component: it is a record, not a control, and nothing here changes.
 */
export function PrivilegeTrail({ changes }: { changes: PrivilegeChange[] }) {
  return (
    <section className="mt-10">
      <h2 className="text-section font-semibold text-ink">Privilege changes</h2>
      <p className="mt-1 max-w-[760px] text-body text-slate">
        Every change to a tier, a function or an organisation assignment, most recent first.
        Written by the database itself, so a change made outside this screen still appears.
      </p>

      {changes.length === 0 ? (
        <p className="mt-4 border border-line rounded-base bg-surface px-3 py-3 text-body text-slate">
          Nothing changed yet.
        </p>
      ) : (
        <table className="mt-4 w-full table-fixed border border-line bg-surface">
          <thead>
            <tr className="border-b border-line text-left text-table-header uppercase tracking-wide text-slate">
              <th className="w-[16%] px-3 py-2 font-medium">When</th>
              <th className="w-[20%] px-3 py-2 font-medium">Changed by</th>
              <th className="w-[22%] px-3 py-2 font-medium">Who</th>
              <th className="px-3 py-2 font-medium">What changed</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((change) => (
              <tr key={change.id} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2 font-time text-time text-slate">
                  {formatDayMonthYear(change.at)}
                </td>
                <td className="px-3 py-2 text-body text-ink">{change.actorName}</td>
                <td className="px-3 py-2 text-body text-ink">{change.what}</td>
                <td className="px-3 py-2 text-body text-slate">{change.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
