import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs work both at the repository's Pages subpath and locally.
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api/lastfm': 'http://localhost:3000',
    },
  },
});