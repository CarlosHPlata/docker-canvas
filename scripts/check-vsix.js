#!/usr/bin/env node
// check-vsix.js
// Unzips a packaged .vsix and loads extension/dist/extension.js in Node with a
// stubbed vscode module.  Exits non-zero if the load throws — which would mean
// the installed extension cannot activate.
//
// Usage:  node scripts/check-vsix.js <path/to/docker-canvas-*.vsix>
//
// Runs on any platform where Node is available:
//   • Linux/macOS: uses system unzip
//   • Windows:     uses PowerShell Expand-Archive as fallback
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const vsixPath = process.argv[2];
if (!vsixPath) {
  console.error('Usage: node scripts/check-vsix.js <path-to.vsix>');
  process.exit(1);
}

if (!fs.existsSync(vsixPath)) {
  console.error(`LOAD FAILED: .vsix not found: ${vsixPath}`);
  process.exit(1);
}

const absVsix = path.resolve(vsixPath);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-check-'));

function unzip(src, dest) {
  // Prefer system unzip; fall back to PowerShell on Windows.
  try {
    execSync(`unzip -q "${src}" -d "${dest}"`);
  } catch (_) {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${src}' -DestinationPath '${dest}'"`,
    );
  }
}

try {
  unzip(absVsix, tmpDir);

  const extJs = path.join(tmpDir, 'extension', 'dist', 'extension.js');
  if (!fs.existsSync(extJs)) {
    console.error('LOAD FAILED: extension/dist/extension.js not found in .vsix');
    process.exit(1);
  }

  // Stub vscode — it is provided by the extension host at runtime, not by npm.
  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') {
      return {};
    }
    return origLoad.call(this, request, parent, isMain);
  };

  try {
    require(extJs);
    const exports = Object.keys(require.cache[require.resolve(extJs)].exports);
    console.log(`LOADED OK, exports: [${exports.map((k) => `'${k}'`).join(', ')}]`);
  } catch (err) {
    console.error(`LOAD FAILED: ${err.code || 'ERROR'} | ${err.message}`);
    process.exit(1);
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
