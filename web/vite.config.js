import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* The build lands inside the server's own public folder, so the studio keeps
   serving plain files exactly as it does today — no build step on deploy, and
   nothing about how the app is put live has to change.
   `/next/` is the new app's own corner: the old one goes on serving `/`
   untouched until every screen here has proved itself. */
export default defineConfig({
  plugins: [react()],
  base: '/next/',
  build: {
    outDir: '../dbbackend/public/next',
    emptyOutDir: true,
    // Plain names rather than hashed ones: the files are committed, and a new
    // hash on every build would leave the repository littered with dead bundles.
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  server: { proxy: { '/api': 'http://localhost:4510', '/uploads': 'http://localhost:4510' } },
});
