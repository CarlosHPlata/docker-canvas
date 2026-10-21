// @ts-check
const path = require('path');
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

/**
 * Resolve plugin: map ssh2 and cpu-features to in-repo stubs so they are
 * bundled into dist/extension.js rather than left as bare require() calls.
 *
 * Why stubs instead of externals:
 *   docker-modem requires ssh2 unconditionally at module load time even though
 *   this extension never opens an SSH connection.  Marking them external leaves
 *   a bare require("ssh2") in the bundle with nothing to satisfy it at runtime
 *   inside the .vsix, causing a hard activation failure (MODULE_NOT_FOUND).
 *   The stubs make the bundle self-contained and throw a clear error if an SSH
 *   code path is ever accidentally reached.
 *
 * @type {import('esbuild').Plugin}
 */
const nativeAddonStubPlugin = {
  name: 'native-addon-stubs',
  setup(build) {
    build.onResolve({ filter: /^ssh2$/ }, () => ({
      path: path.resolve(__dirname, 'scripts/ssh2-stub.js'),
    }));
    build.onResolve({ filter: /^cpu-features$/ }, () => ({
      path: path.resolve(__dirname, 'scripts/cpu-features-stub.js'),
    }));
  },
};

/** @type {import('esbuild').BuildOptions} */
const extensionBuild = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  // vscode is provided by the extension host at runtime.
  // ssh2 and cpu-features are redirected to in-repo stubs by the plugin above.
  external: ['vscode'],
  plugins: [nativeAddonStubPlugin],
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
  ]).then(() => console.log('Watching for changes…'));
} else {
  Promise.all([
    esbuild.build(extensionBuild),
    esbuild.build(webviewBuild),
  ]).catch(() => process.exit(1));
}
