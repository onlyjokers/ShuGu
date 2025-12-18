import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [sveltekit(), basicSsl()],
  server: {
    port: 5174,
    host: process.env.SHUGU_E2E ? '127.0.0.1' : true, // Important for mobile testing
  },
  // Keep Vite cache outside `node_modules/.vite` to avoid EACCES when those artifacts are root-owned.
  cacheDir: `vite-cache-${process.env.USER ?? 'user'}`,
  optimizeDeps: {
    include: ['socket.io-client', 'three'],
  },
});
