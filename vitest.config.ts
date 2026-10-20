import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Use the automatic JSX runtime (react-jsx) so test files don't need to
  // import React manually — matching the tsconfig.webview.json "jsx" setting.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest-setup.ts'],
    // Explicit include prevents out_test/ (tsc build output) from being
    // collected as test sources when that directory is left on disk.
    include: [
      'src/__tests__/**/*.test.ts',
      'webview-src/__tests__/**/*.test.tsx',
    ],
  },
});
