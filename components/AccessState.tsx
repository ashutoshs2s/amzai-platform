/**
 * What to show when row level security correctly returns nothing.
 *
 * Under RLS, "not signed in", "signed in but not staff" and "there is genuinely
 * nothing here" are all zero rows. Rendering "No programs yet." for the first
 * two sends an operator looking for the wrong problem, so each says what is
 * actually true and what would change it.
 *
 * DESIGN.md section 5: say what failed and what to do. No apology.
 */
export function AccessState({
  state,
  email,
}: {
  state: "signed_out" | "no_staff_record";
  email?: string | null;
}) {
  return (
    <div className="border border-line bg-surface p-6">
      {state === "signed_out" ? (
        <>
          <h2 className="text-section font-medium text-ink">Not signed in</h2>
          <p className="mt-2 max-w-2xl text-body text-slate">
            Every screen reads through the signed-in staff member&rsquo;s
            identity, and row level security returns nothing without one. This is
            the database behaving correctly, not an error.
          </p>
          <p className="mt-2 max-w-2xl text-body text-slate">
            Staff sign-in is not built yet. Until it is, the seed script creates
            the accounts and the data behind them.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-section font-medium text-ink">
            No staff record for this account
          </h2>
          <p className="mt-2 max-w-2xl text-body text-slate">
            {email ? (
              <>
                <span className="text-ink">{email}</span> is signed in, but has
                no row in the staff table.
              </>
            ) : (
              "This account is signed in but has no row in the staff table."
            )}{" "}
            Every policy reads the role from there, so this session can see
            nothing.
          </p>
          <p className="mt-2 max-w-2xl text-body text-slate">
            An admin has to add them, or the seed has not been run.
          </p>
        </>
      )}
    </div>
  );
}
