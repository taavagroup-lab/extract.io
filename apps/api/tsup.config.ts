import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@extract\//],
  external: ['@prisma/client', '.prisma/client', 'fastify', '@fastify/cors', '@fastify/rate-limit', 'pino', 'pino-pretty', 'zod', 'jsonwebtoken'],
});
