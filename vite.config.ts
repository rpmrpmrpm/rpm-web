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
  build: {
    // Every asset stays a file. The site's content policy refuses data: fonts.
    assetsInlineLimit: 0,
  },
  server: {
    // 127.0.0.1, because a Google or Apple sign-in on the dev server comes back to the loopback address (see
    // SocialReturn in src/api/session.ts). A bare "localhost" listens on ::1 alone on some systems. Browsers
    // still reach this server as localhost.
    host: '127.0.0.1',
    proxy: {
      '/api': forward('/api', 'https://api.rpmrpmrpm.com', key ? { 'X-RPM-Key': key } : {}),
      '/accounts': forward('/accounts', 'https://accounts.rpmrpmrpm.com'),
    },
  },
  worker: { format: 'es' },
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
});
