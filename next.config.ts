import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` otherwise appends a block of its own instructions to CLAUDE.md
  // every time it starts. CLAUDE.md is our operating document and Next.js does
  // not get to edit it. The one useful thing that block said is recorded in
  // CLAUDE.md ourselves, under working conventions.
  agentRules: false,

  turbopack: {
    // Pin the project root. Without this, Next.js walks up the filesystem
    // looking for a lockfile and can pick one up from outside the repo, which
    // makes the build depend on what happens to be in the parent folders.
    root: __dirname,
  },
};

export default nextConfig;

// Note for later: when this app first uses a Cloudflare binding (KV, R2, D1,
// Durable Objects), add `initOpenNextCloudflareForDev()` from
// @opennextjs/cloudflare here so `next dev` can see those bindings. It is left
// out on purpose while there are no bindings, because it starts a local
// Cloudflare runtime that `npm run dev` does not otherwise need.
