import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
    plugins: [sveltekit(), basicSsl()],
    server: {
        port: 5173,
        host: true
    },
    optimizeDeps: {
        include: ['socket.io-client']
    }
});
