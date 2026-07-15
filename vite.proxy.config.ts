import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    ssr: path.resolve(__dirname, 'proxy.js'),
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: 'proxy.js',
      },
    },
  },
});
