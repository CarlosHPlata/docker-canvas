/**
 * VS Code injects acquireVsCodeApi() into every webview's JavaScript context.
 * This declaration makes it available as a typed global.
 */
interface VsCodeWebviewApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeWebviewApi;
