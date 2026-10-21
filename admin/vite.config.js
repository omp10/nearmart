import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the API is proxied, so the panel and API share an origin and
// the refresh cookie works with SameSite=Strict.
export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        port: 5173,
        // API_PROXY_TARGET lets the end-to-end tests point the panel at their own API.
        proxy: {
            '/api': process.env.API_PROXY_TARGET || 'http://localhost:5000',
            '/uploads': process.env.API_PROXY_TARGET || 'http://localhost:5000'
        }
    }
});
