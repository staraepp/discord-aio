import { defineConfig } from 'tsup';

// Bundle workspace packages (they ship TypeScript source); keep npm deps external.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/^@aio\//],
  external: ['discord.js', 'lavalink-client', 'pino', 'pg', '@prisma/client', '@prisma/adapter-pg', 'zod', 'dotenv'],
});
