/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Loaded by Node at runtime, not bundled: PGlite ships a wasm Postgres.
    serverComponentsExternalPackages: ['@electric-sql/pglite', 'postgres'],
  },
  images: { unoptimized: true },
};

export default nextConfig;
