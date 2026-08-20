/**
 * Two hostnames, one application.
 *
 * CLAUDE.md rule 6: client-facing surfaces live only on client.amzai.events,
 * internal screens only on app.amzai.events. Never render an internal screen on
 * the client domain, and never put Cloudflare Access in front of the client one,
 * because clients cannot authenticate to it.
 *
 * The split is enforced in proxy.ts by the Host header. Client surfaces live
 * under the /c path prefix in the codebase; on the client host the prefix is
 * invisible, because the proxy rewrites onto it.
 *
 * In development there is one server on one port, so the client host is
 * `client.localhost:3000`. Browsers resolve anything under .localhost to
 * 127.0.0.1 without a hosts file, so it works with nothing installed and
 * nothing configured. Both hostnames reach the same `npm run dev`.
 */

/** Where client-facing routes live in the file tree. Never seen in a URL. */
export const CLIENT_PREFIX = "/c";

/**
 * Hosts that count as the client surface. Matched on the hostname only, so a
 * port never has to be listed.
 */
export const CLIENT_HOSTS = [
  "client.amzai.events",
  "client.localhost",
  // Preview deployments, where both surfaces share one hostname and the split
  // cannot be enforced. Only ever true off production.
  ...(process.env.NEXT_PUBLIC_CLIENT_HOST ? [process.env.NEXT_PUBLIC_CLIENT_HOST] : []),
];

export function isClientHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0].toLowerCase();
  return CLIENT_HOSTS.includes(hostname);
}

/**
 * Where a link in an email should point.
 *
 * Explicit rather than derived from the request, because the email is sent from
 * the internal app and must carry a URL on the client domain. Deriving it would
 * send clients a link to a host they cannot reach.
 */
export function clientOrigin(): string {
  return process.env.NEXT_PUBLIC_CLIENT_ORIGIN ?? "http://client.localhost:3000";
}
