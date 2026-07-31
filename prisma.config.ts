import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Prisma configuration.
 *
 * Replaces the deprecated `package.json#prisma` block. Unlike the old CLI
 * behaviour, a config file does NOT auto-load `.env`, so we load it explicitly
 * before the datasource URL is read. `process.loadEnvFile` is built into Node
 * ≥20.12, which keeps `dotenv` out of the dependency tree.
 */
try {
  process.loadEnvFile(path.join(process.cwd(), '.env'));
} catch {
  // `.env` is optional — every value has a default.
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
