import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` is set from BASE_PATH so the same build works on a user/org Pages site
// (served at /) and on a project Pages site (served at /<repo>/).
export default defineConfig({
  root: 'web',
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  define: {
    // FIVB's tournament photographs, off until FIVB agrees to their use. A
    // constant rather than an environment read at runtime, so a build without
    // the switch drops the photo strip's dynamic import as dead code: no
    // chunk, no stylesheet rules, no string a reader could find. The same
    // variable makes ingest/photos.ts write the photo files; see there.
    __TOURNAMENT_PHOTOS__: JSON.stringify(process.env.TOURNAMENT_PHOTOS === '1'),
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // dist/.vite/manifest.json: which chunks each page needs. The prerenderer
    // reads it to preload them from each page's head — see `routeChunks` in
    // ingest/prerender.ts.
    manifest: true,
    // One stylesheet for every page, as before the pages were split into
    // chunks. Split per page, a component's look came to depend on which
    // other page's CSS happened to be loaded: the tournament page leaned on
    // `.sr-only` from the table, `.segmented` from the controls and the
    // `main` layout rule from the graph, and lost all three. 8 KB gzipped is
    // not worth auditing every cross-page dependency for, and the prerendered
    // markup is styled from the first paint because the sheet is in the head.
    cssCodeSplit: false,
  },
});
