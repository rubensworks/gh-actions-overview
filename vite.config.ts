import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The app is deployed to a GitHub Pages project subpath (https://<user>.github.io/gh-actions-overview/),
// So all asset URLs are emitted relative to index.html.
export default defineConfig({
  base: './',
  plugins: [ react() ],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
