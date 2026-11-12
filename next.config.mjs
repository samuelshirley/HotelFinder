/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Served at feraltravels.com/hotels. Must equal BASE_PATH in src/lib/basePath.ts (guarded).
  basePath: '/hotels',
  // The e2e run starts its own dev server on this folder. It builds into its own
  // directory, or it overwrites the build of a dev server that is already running.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    // Loaded by Node at runtime, not bundled: PGlite ships a wasm Postgres.
    serverComponentsExternalPackages: ['@electric-sql/pglite', 'postgres'],
  },
  images: { unoptimized: true },
  // localhost:3000 and the bare *.vercel.app URL land on the app, not a 404.
  async redirects() {
    return [{ source: '/', destination: '/hotels', basePath: false, permanent: false }];
  },
};

export default nextConfig;
