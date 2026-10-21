// cpu-features-stub.js
// Bundled in place of the real cpu-features native addon.
//
// cpu-features is a native addon required by ssh2 to probe CPU capabilities
// for cipher selection.  Since ssh2 itself is stubbed (see ssh2-stub.js),
// the real cpu-features binary is never needed.  This empty object satisfies
// any top-level require() without shipping a platform-specific .node file.
'use strict';

module.exports = {};
