import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    preprocess: vitePreprocess(),
    kit: {
        outDir: '.svelte-kit-client',
        adapter: adapter({ out: 'build-client' }),
        alias: {
            '$lib': './src/lib',
            '$components': './src/lib/components'
        }
    }
};

export default config;
