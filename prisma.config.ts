import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ quiet: true });

// `prisma generate` does not need a live database; migrate commands do.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
