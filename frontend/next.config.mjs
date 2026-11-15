import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the tracing root here, so a stray lockfile in a parent directory is never taken as the root.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  devIndicators: false,

  // A static export served by a Worker under /time-track (worker.js): no Next.js server,
  // so no image optimization endpoint either.
  output: 'export',
  basePath: '/time-track',
  images: { unoptimized: true },

  // `npm run build:check` writes .next-build/, so a verification build never collides with a
  // running dev server's .next/.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default nextConfig;
