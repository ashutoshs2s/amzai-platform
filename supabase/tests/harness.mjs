/**
 * A real Postgres to test the migrations against.
 *
 * pglite is Postgres compiled to WebAssembly: actual row level security, actual
 * triggers, actual constraints, in-process and disposable. It is a devDependency
 * and nothing in the application imports it.
 *
 * Why this exists rather than testing against the Supabase project: these suites
 * write, delete and deliberately violate constraints. Running them against the
 * real database would either corrupt it or force every test to be read-only,
 * and a read-only test of a write path proves nothing.
 *
 * What it does NOT cover: PostgREST. Everything here speaks SQL directly, so a
 * policy is proven and an embed in a .select() string is not.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS = join(HERE, "..", "migrations");

/**
 * Everything Supabase provides that pglite does not: the auth schema, the three
 * roles, and auth.uid().
 *
 * auth.uid() reads the JWT claim the way Supabase does, and falls back to a
 * plain setting so a JavaScript suite can impersonate somebody without building
 * a JWT. The SQL suite in this directory uses the claim; these use the setting.
 */
const SUPABASE_SHIM = `
  create schema if not exists auth;
  do $$ begin create role anon;          exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role;  exception when duplicate_object then null; end $$;

  create or replace function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid,
      nullif(current_setting('test.actor', true), '')::uuid
    )
  $$;
`;

function migrationFiles() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * A database with every migration applied, in order.
 *
 * The staff row for the super admin is created before the tier migration runs,
 * because that is the state the real database was in: the migration promotes an
 * existing person and cannot invent one. Testing it any other way would test a
 * situation that never happens.
 *
 * `twice` applies each migration a second time at its own point in the
 * sequence, which is the state a half-failed `supabase db push` leaves behind.
 */
export async function freshDatabase({ twice = false } = {}) {
  const db = await PGlite.create();
  await db.exec(SUPABASE_SHIM);

  const files = migrationFiles();
  const tierAt = files.findIndex((f) => f.includes("privilege_tiers"));

  const apply = async (file) => {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const pass of twice ? [1, 2] : [1]) {
      try {
        await db.exec(sql);
      } catch (error) {
        throw new Error(`${file} failed on pass ${pass}:\n  ${error.message}`);
      }
    }
  };

  for (const file of files.slice(0, tierAt)) await apply(file);

  await db.exec(`insert into public.users (id, full_name, email, role)
                 values (gen_random_uuid(), 'Ash Prasad', 'ash@amzai.ai', 'admin')`);

  for (const file of files.slice(tierAt)) await apply(file);

  return db;
}

export function migrationCount() {
  return migrationFiles().length;
}

/* -------------------------------------------------------------------------- */
/* Talking to it                                                              */
/* -------------------------------------------------------------------------- */

/** Rows, as the privileged owner. Row level security does not apply. */
export const rows = async (db, sql) => (await db.query(sql)).rows;

/** One value, as the privileged owner. */
export const one = async (db, sql) => (await db.query(sql)).rows[0];

/**
 * Run something as a signed-in staff member, with row level security enforced.
 *
 * The role switch is what turns policies on: pglite runs as the table owner
 * otherwise, and an owner bypasses row level security entirely. A suite that
 * forgot this would pass every case while proving nothing.
 */
export async function asUser(db, userId, sql) {
  await db.exec(`set role authenticated; set test.actor = '${userId}';`);
  try {
    return { rows: (await db.query(sql)).rows, error: null };
  } catch (error) {
    return { rows: null, error: error.message };
  } finally {
    await db.exec("reset role; reset test.actor;");
  }
}

/** How many rows of a table somebody can see, or the error that stopped them. */
export async function countAs(db, userId, table, where = "") {
  const result = await asUser(
    db,
    userId,
    `select count(*)::int as n from public.${table} ${where}`,
  );
  return result.rows ? result.rows[0].n : `ERROR: ${result.error}`;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A collector rather than an assertion library.
 *
 * Every case runs and every case reports, including the ones that fail. A suite
 * that stops at the first failure hides how much else is broken, which on a
 * permissions change is exactly what you need to know.
 */
export function suite(title) {
  const results = [];

  const check = (name, pass, detail = "") => {
    results.push({ name, pass: Boolean(pass), detail });
    return Boolean(pass);
  };

  return {
    check,

    /** Deep equality, reported with both sides when it fails. */
    equal(name, actual, expected) {
      const same = JSON.stringify(actual) === JSON.stringify(expected);
      return check(
        name,
        same,
        `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`,
      );
    },

    /** The statement must be refused, optionally with a message that says why. */
    async refuses(name, db, userId, sql, contains) {
      const result = userId
        ? await asUser(db, userId, sql)
        : await (async () => {
            try {
              await db.exec(sql);
              return { error: null };
            } catch (e) {
              return { error: e.message };
            }
          })();

      if (result.error === null) return check(name, false, "it was accepted");
      return check(
        name,
        contains ? result.error.includes(contains) : true,
        result.error.slice(0, 100),
      );
    },

    /** The statement must be allowed. */
    async allows(name, db, userId, sql) {
      const result = userId
        ? await asUser(db, userId, sql)
        : await (async () => {
            try {
              await db.exec(sql);
              return { error: null };
            } catch (e) {
              return { error: e.message };
            }
          })();
      return check(name, result.error === null, result.error ?? "");
    },

    report() {
      console.log(`\n  ${title}\n  ${"-".repeat(66)}`);
      for (const r of results) {
        console.log(
          `  ${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `\n        ${r.detail}`}`,
        );
      }
      const failed = results.filter((r) => !r.pass).length;
      console.log(`\n  ${results.length - failed}/${results.length} passed\n`);
      return { total: results.length, failed };
    },
  };
}
