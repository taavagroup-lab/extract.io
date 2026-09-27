import { defineConfig } from 'tsup';

// Bundles the server and the internal workspace packages (which ship TS
// source) into dist/. Third-party deps and Prisma stay external.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@extract\//],
  external: ['@prisma/client', '.prisma/client', 'ws', 'pino', 'pino-pretty', '@msgpack/msgpack', 'jsonwebtoken'],
});
