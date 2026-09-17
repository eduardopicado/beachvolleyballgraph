import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'ingest/**/*.test.ts', 'web/src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['shared/**/*.ts', 'ingest/**/*.ts', 'web/src/**/*.ts'],
      // No `.tsx`: no unit test renders a component, so every one of them
      // reported 0% and dragged the headline figure to 34% (measured, 17 Sept
      // 2026) for a tree that 150 Playwright tests drive end to end. A number
      // that says "a third of the code is tested" when the other two thirds
      // are covered by a different suite invites exactly the wrong conclusion,
      // and it did. With components out, the figure describes what this suite
      // is responsible for: the ingest and the pure helpers.
      //
      // The alternative, instrumenting the Vite build with Istanbul and
      // merging what each Playwright page collects, would give one true
      // figure at the cost of a plugin, a merge step and a slower e2e run. Not
      // worth it for a number nobody acts on; this comment is the record of
      // why the report is scoped rather than whole.
      //
      // `ingest/main.ts` and `ingest/prerender.ts` stay in, low as they are:
      // that is the real gap, and the report should keep saying so.
      exclude: ['**/*.test.ts'],
      reporter: ['text', 'html'],
    },
  },
});
