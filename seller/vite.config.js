import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Served by nginx at /seller/ on the API's own domain. In development the API
// is proxied, so the dashboard and API share an origin and the nm_srt refresh
// cookie works with SameSite=Strict.
const target = process.env.API_PROXY_TARGET || 'http://localhost:5000';

export default defineConfig({
    base: '/seller/',
    plugins: [react(), tailwindcss()],
    server: {
        port: 5174,
        strictPort: true,
        proxy: { '/api': target, '/uploads': target }
    }
});
