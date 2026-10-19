import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the API is proxied, so the panel and API share an origin and
// the refresh cookie works with SameSite=Strict.
export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://localhost:5000',
            '/uploads': 'http://localhost:5000'
        }
    }
});
