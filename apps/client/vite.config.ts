import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [sveltekit()],
    server: {
        port: 5174,
        host: true // Important for mobile testing
    },
    optimizeDeps: {
        include: ['socket.io-client', 'three']
    }
});
