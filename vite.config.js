import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  // GitHub Pages sert le site sous /football-ai/
  base: process.env.GITHUB_ACTIONS ? '/football-ai/' : '/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['.e2b.app', '.e2b-app.e2b.dev'],
    headers: { 'X-Frame-Options': 'ALLOWALL' }
  }
})
