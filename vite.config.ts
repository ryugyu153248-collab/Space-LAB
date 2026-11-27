/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium') },
  build: {
    chunkSizeWarningLimit: 4000,
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
