import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// In development the dev server stands in for the edge of the deployed site: it sends /api and
// /accounts to the live services. A contributor's developer key goes in RPM_APP_KEY, and it stays in
// this process. The deployed site uses no key, because every call there carries the user's token.
const key = process.env.RPM_APP_KEY;

function forward(prefix: string, target: string, headers: Record<string, string> = {}) {
  return {
    target,
    changeOrigin: true,
    headers,
    rewrite: (path: string) => path.slice(prefix.length),
  };
}

export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      '/api': forward('/api', 'https://api.rpmrpmrpm.com', key ? { 'X-RPM-Key': key } : {}),
      '/accounts': forward('/accounts', 'https://accounts.rpmrpmrpm.com'),
    },
  },
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
});
