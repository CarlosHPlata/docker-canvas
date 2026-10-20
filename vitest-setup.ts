/**
 * Vitest global setup file.
 *
 * Runs before every test file. Sets up the jsdom globals that the webview code
 * expects to find in a real VS Code webview context.
 */

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount React trees and remove event listeners between tests.
// @testing-library/react ships automatic cleanup only when `afterEach` is
// available as a global; in vitest without `globals: true` we wire it up here.
afterEach(cleanup);

// VS Code injects acquireVsCodeApi() into every webview page. Provide a
// lightweight stub so App.tsx can call it at module-evaluation time.
(globalThis as Record<string, unknown>)['acquireVsCodeApi'] = () => ({
  postMessage: () => {},
  getState: () => undefined,
  setState: () => {},
});

// jsdom does not implement requestAnimationFrame / cancelAnimationFrame.
// Make them synchronous no-ops so canvas code that calls fitView inside rAF
// resolves immediately in tests.
(globalThis as Record<string, unknown>)['requestAnimationFrame'] = (
  cb: FrameRequestCallback,
) => {
  cb(0);
  return 0;
};
(globalThis as Record<string, unknown>)['cancelAnimationFrame'] = () => {};

// ResizeObserver is used internally by @xyflow/react.
(globalThis as Record<string, unknown>)['ResizeObserver'] = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
