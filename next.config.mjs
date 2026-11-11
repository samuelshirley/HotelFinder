/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The e2e run starts its own dev server on this folder. It builds into its own
  // directory, or it overwrites the build of a dev server that is already running.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    // Loaded by Node at runtime, not bundled: PGlite ships a wasm Postgres.
    serverComponentsExternalPackages: ['@electric-sql/pglite', 'postgres'],
  },
  images: { unoptimized: true },
};

export default nextConfig;
