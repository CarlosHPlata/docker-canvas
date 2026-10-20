// @ts-check
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionBuild = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  // vscode is provided by the extension host at runtime; ssh2 and cpu-features
  // ship native .node addons that esbuild cannot bundle — they are loaded from
  // node_modules/ by the extension host at runtime.
  external: ['vscode', 'ssh2', 'cpu-features'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewBuild = {
  entryPoints: ['webview-src/index.tsx'],
  bundle: true,
  // CSS is emitted as dist/webview/index.css alongside the JS
  outdir: 'dist/webview',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  // Use the automatic JSX runtime (React 17+ — no need to import React in every file)
  jsx: 'automatic',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
};

if (watch) {
  Promise.all([
    esbuild.context(extensionBuild).then((ctx) => {
      void ctx.watch();
    }),
    esbuild.context(webviewBuild).then((ctx) => {
      void ctx.watch();
    }),
  ]).then(() => console.log('Watching for changes\u2026'));
} else {
  Promise.all([
    esbuild.build(extensionBuild),
    esbuild.build(webviewBuild),
  ]).catch(() => process.exit(1));
}
