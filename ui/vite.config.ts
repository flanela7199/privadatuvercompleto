import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The panel reuses the EXACT same three.js build + ToiletTuber/accessories from ../web/src.
const web = path.resolve(__dirname, '../web');

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^three\/addons\/(.*)$/, replacement: `${web}/vendor/three/addons/$1` },
      { find: /^three$/, replacement: `${web}/vendor/three/three.module.js` },
    ],
  },
  server: { fs: { allow: [path.resolve(__dirname, '..')] } },
  build: {
    outDir: '../web/panel',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
});
