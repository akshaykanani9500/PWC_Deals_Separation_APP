import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // Read PORT / WEB_PORT from .env too (the API reads the same file), so changing PORT in .env keeps the proxy in step.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const apiPort = Number(env.PORT || 4000);
  const webPort = Number(env.WEB_PORT || 5173);
  return {
  root: 'client',
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(__dirname, 'shared') } },
  server: {
    port: webPort,
    strictPort: false,
    proxy: { '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true } },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split big libraries into their own cached files.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          grid: ['react-grid-layout'],
        },
      },
    },
  },
  };
});
