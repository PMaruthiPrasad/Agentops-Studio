import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    // Type errors should fail the build. Never relax this.
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  experimental: {
    // Keeps the Prisma client out of the client bundle graph.
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  // `pdfkit` loads its font-metric `.afm` files from a path relative to its own
  // `__dirname`. Bundling it rewrites that to `.next/server/vendor-chunks`,
  // where the data directory does not exist, so PDF export fails at
  // construction with ENOENT. Leaving it external keeps the path in
  // node_modules where the files actually are.
  serverExternalPackages: ['@prisma/client', 'prisma', 'pdfkit'],
};

export default nextConfig;
