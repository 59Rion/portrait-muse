import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), publicDir: false, resolve: { alias: { '@': fileURLToPath(new URL('../..', import.meta.url)) } }, css: { postcss: { plugins: [tailwindcss()] } }, plugins: [react()], server: { host: '127.0.0.1', port: 4174, strictPort: true } });
