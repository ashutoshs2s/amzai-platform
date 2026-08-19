/**
 * The magic-link flow, and the two properties that fail silently.
 *
 * First: attribution. Client routes run under the service role with no
 * auth.uid(), so a write made outside these functions records as 'system' and
 * the client's action is attributed to nobody. Nothing errors. The audit row is
 * simply wrong, and stays wrong.
 *
 * Second: the plaintext token never reaching the database. One well-meaning
 * change — hashing in SQL instead of Node "so the route is simpler" — destroys
 * it, and no amount of reading the screen would show it. So the last section
 * runs the real flow with a real token and then searches every text column in
 * the database for it.
 */

import { createHash, randomBytes } from "node:crypto";

import { freshDatabase, one, rows, suite } from "./harness.mjs";

const t = suite("Client link flow");
const db = await freshDatabase();

/** The same two lines lib/client/token.ts uses. */
const newToken = () => {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
};

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const b2b = (await one(db, `select id from public.client_types where slug = 'b2b_tech'`)).id;
const org = (
  await one(db, `insert into public.organisations (name, slug, client_type_id)
                 values ('Acme','acme','${b2b}') returning id`)
).id;
const progA = (
  await one(db, `insert into public.programs (organisation_id, name, slug, type)
                 values ('${org}','A','a','event') returning id`)
).id;
const progB = (
  await one(db, `insert into public.programs (organisation_id, name, slug, type)
                 values ('${org}','B','b','event') returning id`)
).id;

const helena = (
  await one(db, `insert into public.client_contacts (program_id, organisation_id, name, email)
                 values ('${progA}','${org}','Helena Vaughan','helena@client.test') returning id`)
).id;
const marcus = (
  await one(db, `insert into public.client_contacts (program_id, organisation_id, name, email)
                 values ('${progA}','${org}','Marcus Webb','marcus@client.test') returning id`)
).id;
await db.exec(`insert into public.client_contacts (program_id, organisation_id, name, email)
               values ('${progB}','${org}','Other Person','other@client.test')`);

const request = (email, hash, programme = progA, ip = "'203.0.113.10'") =>
  `select public.request_client_link('${programme}','${email}','${hash}',
     clock_timestamp() + interval '30 minutes', ${ip}) as result`;

const issued = async (email, hash, programme = progA, ip = "'203.0.113.10'") =>
  (await one(db, request(email, hash, programme, ip))).result.issued;

/* -------------------------------------------------------------------------- */
/* A link is issued only to an active contact of that programme               */
/* -------------------------------------------------------------------------- */

t.check("a known contact gets a link", (await issued("helena@client.test", newToken().hash)) === true);
t.check("an unknown address does not", (await issued("stranger@nowhere.test", newToken().hash)) === false);
t.check("and neither does a contact of another programme",
  (await issued("other@client.test", newToken().hash)) === false);
t.check("addresses match case-insensitively",
  (await issued("HELENA@CLIENT.TEST", newToken().hash)) === true);

await db.exec(`update public.client_contacts set active = false where id = '${marcus}'`);
t.check("a deactivated contact gets nothing",
  (await issued("marcus@client.test", newToken().hash)) === false);
await db.exec(`update public.client_contacts set active = true where id = '${marcus}'`);

/*
  The neutral response. Every case above returned the same shape, and that is
  what stops the endpoint being an address oracle: the caller cannot tell a
  stranger from a contact, so it cannot leak the difference by accident.
*/
const shapes = new Set();
for (const [email, prog] of [
  ["helena@client.test", progA],
  ["stranger@nowhere.test", progA],
  ["other@client.test", progA],
]) {
  const result = (await one(db, request(email, newToken().hash, prog, "'203.0.113.44'"))).result;
  shapes.add(JSON.stringify(Object.keys(result).sort()));
}
t.equal("every outcome returns the same shape", [...shapes], ['["issued"]']);

/* -------------------------------------------------------------------------- */
/* Attribution: the thing that fails silently                                 */
/* -------------------------------------------------------------------------- */

const linkAudit = await one(
  db,
  `select actor_type, actor_id, actor_contact_id
   from public.audit_events
   where table_name = 'client_link_requests'
   order by occurred_at desc limit 1`,
);
t.check("a link request is attributed to the contact, not to the system",
  linkAudit?.actor_type === "client_contact", JSON.stringify(linkAudit));
t.check("and names which contact", linkAudit?.actor_contact_id === helena);
t.check("with no staff actor, because there was no staff member",
  linkAudit?.actor_id === null);

/* -------------------------------------------------------------------------- */
/* Rate limiting, in the database so a fast route cannot skip it              */
/* -------------------------------------------------------------------------- */

{
  // A contact and an IP that nothing above has touched, so the boundary is
  // exactly where the limit puts it and not where earlier cases left it.
  await db.exec(`insert into public.client_contacts (program_id, organisation_id, name, email)
                 values ('${progA}','${org}','Limit Person','limit@client.test')`);

  const results = [];
  for (let i = 0; i < 6; i += 1) {
    results.push(await issued("limit@client.test", newToken().hash, progA, `'198.51.100.${i + 1}'`));
  }
  t.equal("five per address per hour: the sixth is refused",
    results, [true, true, true, true, true, false]);

  t.check("every attempt was recorded, including the refused one",
    (await one(db, `select count(*)::int as n from public.client_link_attempts
                    where email_bucket = md5('limit@client.test')`)).n === 6);
  t.check("but only five links exist",
    (await one(db, `select count(*)::int as n from public.client_link_requests r
                    join public.client_contacts c on c.id = r.client_contact_id
                    where c.email = 'limit@client.test'`)).n === 5);
}

{
  /*
    The IP limit is checked before the address is looked up, which is what makes
    it useful: an attacker enumerating addresses is never a contact, so a limit
    that only counted matches would never see them. Twenty strangers from one
    IP, then a real contact from the same IP — refused, because the IP is spent.
  */
  const ip = "'198.51.100.200'";
  await db.exec(`insert into public.client_contacts (program_id, organisation_id, name, email)
                 values ('${progA}','${org}','Ip Person','ip@client.test')`);

  for (let i = 0; i < 20; i += 1) {
    await issued(`stranger-${i}@nowhere.test`, newToken().hash, progA, ip);
  }
  t.check("twenty attempts from one IP are recorded",
    (await one(db, `select count(*)::int as n from public.client_link_attempts
                    where request_ip = ${ip}`)).n === 20);

  t.check("the twenty-first is refused even for a real contact",
    (await issued("ip@client.test", newToken().hash, progA, ip)) === false);

  t.check("while the same contact from a different IP is issued one",
    (await issued("ip@client.test", newToken().hash, progA, "'198.51.100.201'")) === true);
}

t.check("an attempt never stores the address itself",
  (await rows(db, `select column_name from information_schema.columns
                   where table_name = 'client_link_attempts'`))
    .every((c) => c.column_name !== "email"),
);

/* -------------------------------------------------------------------------- */
/* Following a link                                                           */
/* -------------------------------------------------------------------------- */

// A fresh contact and IP, so the limits above do not interfere.
const link = newToken();
await db.exec(`insert into public.client_contacts (program_id, organisation_id, name, email)
               values ('${progA}','${org}','Fresh Person','fresh@client.test')`);
t.check("a fresh contact is issued a link",
  (await issued("fresh@client.test", link.hash, progA, "'203.0.113.99'")) === true);

const session = newToken();
const consume = (linkHash, programme, sessionHash) =>
  `select public.consume_client_link('${linkHash}','${programme}','${sessionHash}',
     clock_timestamp() + interval '7 days') as result`;

t.check("a link for another programme is refused",
  (await one(db, consume(link.hash, progB, newToken().hash))).result.ok === false);
t.check("and nothing was consumed by trying",
  (await one(db, `select consumed_at from public.client_link_requests
                  where token_hash = '${link.hash}'`)).consumed_at === null);

const consumed = (await one(db, consume(link.hash, progA, session.hash))).result;
t.check("the right programme exchanges it for a session", consumed.ok === true);
t.check("and the session belongs to that contact",
  (await one(db, `select public.client_session_contact('${session.hash}','${progA}') as id`)).id
    === consumed.contact_id);

t.check("the link cannot be used twice",
  (await one(db, consume(link.hash, progA, newToken().hash))).result.ok === false);

const sessionAudit = await one(
  db,
  `select actor_type, actor_contact_id from public.audit_events
   where table_name = 'client_sessions' order by occurred_at desc limit 1`,
);
t.check("issuing a session is attributed to the contact too",
  sessionAudit?.actor_type === "client_contact" &&
    sessionAudit?.actor_contact_id === consumed.contact_id,
  JSON.stringify(sessionAudit));

t.check("a session for one programme is not a session for another",
  (await one(db, `select public.client_session_contact('${session.hash}','${progB}') as id`)).id
    === null);

await db.exec(`update public.client_sessions set revoked_at = clock_timestamp()
               where token_hash = '${session.hash}'`);
t.check("a revoked session names nobody",
  (await one(db, `select public.client_session_contact('${session.hash}','${progA}') as id`)).id
    === null);

{
  const expired = newToken();
  const expiredSession = newToken();
  /*
    Aged, not born expired. The table refuses expires_at <= created_at, which is
    correct — a link that arrives already dead is a bug, not a state — so this
    backdates both and lets the clock have passed it.
  */
  await db.exec(`insert into public.client_link_requests
                   (program_id, client_contact_id, token_hash, created_at, expires_at)
                 values ('${progA}','${helena}','${expired.hash}',
                         clock_timestamp() - interval '2 hours',
                         clock_timestamp() - interval '1 hour')`);
  t.check("an expired link is refused",
    (await one(db, consume(expired.hash, progA, expiredSession.hash))).result.ok === false);
}

/* -------------------------------------------------------------------------- */
/* THE PLAINTEXT TOKEN NEVER REACHES THE DATABASE                             */
/*                                                                            */
/* Run the whole flow with a token nobody else will ever generate, then look   */
/* for it in every text-bearing column there is. If a later change hashes in   */
/* SQL instead of Node, the plaintext lands in a query — and therefore in      */
/* pg_stat_statements and any statement log — and this is what says so.        */
/* -------------------------------------------------------------------------- */

{
  const secret = newToken();
  const sessionSecret = newToken();

  await db.exec(`insert into public.client_contacts (program_id, organisation_id, name, email)
                 values ('${progA}','${org}','Scan Person','scan@client.test')`);
  await one(db, request("scan@client.test", secret.hash, progA, "'203.0.113.123'"));
  await one(db, consume(secret.hash, progA, sessionSecret.hash));

  const columns = await rows(
    db,
    `select c.table_name, c.column_name
     from information_schema.columns c
     join information_schema.tables t
       on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and t.table_type = 'BASE TABLE'
       and c.data_type in ('text','character varying','jsonb','json')`,
  );

  const hits = [];
  for (const { table_name, column_name } of columns) {
    const found = await one(
      db,
      `select count(*)::int as n from public."${table_name}"
       where "${column_name}"::text like '%${secret.token}%'`,
    );
    if (found.n > 0) hits.push(`${table_name}.${column_name}`);
  }

  t.check(
    `the plaintext link token appears in none of the ${columns.length} text columns`,
    hits.length === 0,
    `found in ${hits.join(", ")}`,
  );

  const sessionHits = [];
  for (const { table_name, column_name } of columns) {
    const found = await one(
      db,
      `select count(*)::int as n from public."${table_name}"
       where "${column_name}"::text like '%${sessionSecret.token}%'`,
    );
    if (found.n > 0) sessionHits.push(`${table_name}.${column_name}`);
  }
  t.check("nor does the plaintext session token", sessionHits.length === 0,
    `found in ${sessionHits.join(", ")}`);

  // The hash, by contrast, is stored — that is the point — but the audit trail
  // redacts it, so a leaked audit export does not hand over a usable token.
  t.check("the hash is what is stored",
    (await one(db, `select count(*)::int as n from public.client_link_requests
                    where token_hash = '${secret.hash}'`)).n === 1);
  t.check("and the audit trail redacts even that",
    (await one(db, `select count(*)::int as n from public.audit_events
                    where table_name = 'client_link_requests'
                      and after::text like '%${secret.hash}%'`)).n === 0);
}

process.exit(t.report().failed ? 1 : 0);
