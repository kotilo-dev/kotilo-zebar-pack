import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// One project, one page per widget. Zebar loads the pages from disk, so every
// asset path has to be relative (`base: './'`).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: mode === 'development',
    minify: mode !== 'development',
    rollupOptions: {
      input: { bar: 'bar.html', island: 'island.html' },
    },
  },
}));
