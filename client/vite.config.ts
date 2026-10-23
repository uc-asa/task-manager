import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in dev: the browser talks to Vite, which forwards /api to Express.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
