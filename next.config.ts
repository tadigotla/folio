import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 blocks cross-origin requests to /_next/* dev resources by default.
  // Folio is a single-user local app; accessing the dev server from other
  // hosts on the same network (Tailscale, LAN) is expected, and the block
  // breaks HMR + hydration for anything not on localhost. The 100.64/10 CGNAT
  // range covers Tailscale; add your own LAN host if you proxy from one.
  allowedDevOrigins: ['100.113.5.65', 'localhost'],
};

export default nextConfig;
