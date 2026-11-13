import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages : https://<org>.github.io/<dépôt>/ (BASE_PATH=/<dépôt>/)
  base: process.env.BASE_PATH ?? './',
  test: { testTimeout: 120000 },
});
