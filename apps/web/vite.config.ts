import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '');
  const api = env.API_URL || 'http://localhost:3001';
  const game = (env.GAME_SERVER_URL || 'ws://localhost:3002/ws').replace(/\/ws$/, '');
  return {
    plugins: [react()],
    envDir: root,
    server: {
      port: 5173,
      strictPort: true,
      // Same-origin proxies: the browser only talks to the Vite dev server.
      proxy: {
        '/api': { target: api, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
        '/ws': { target: game, ws: true, changeOrigin: true },
      },
    },
    build: {
      chunkSizeWarningLimit: 2000,
    },
  };
});
