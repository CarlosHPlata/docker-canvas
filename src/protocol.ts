/**
 * Typed message protocol between the extension host and the Docker Canvas webview.
 *
 * This module is the single source of truth for the postMessage contract.
 * Import it on both sides so extension-host and webview types cannot drift.
 */

// ── Shared types ─────────────────────────────────────────────────────────────

/** Docker container lifecycle states we surface on the canvas. */
export type ContainerState =
  | 'running'
  | 'exited'
  | 'created'
  | 'paused'
  | 'restarting'
  | 'removing'
  | 'dead';

/** Docker health-check result surfaced on the canvas. */
export type ContainerHealth = 'healthy' | 'unhealthy' | 'starting' | 'none';

export interface ContainerInfo {
  /** Full 64-char Docker container ID. */
  id: string;
  /** Human-readable container name (leading slash stripped). */
  name: string;
  /** Image reference, e.g. "nginx:latest". */
  image: string;
  /** Current container lifecycle state. */
  state: ContainerState;
  /** Health-check status ('none' when no healthcheck is configured). */
  health: ContainerHealth;
  /** docker-compose project name, if present in container labels. */
  composeProject?: string;
  /** Names of all networks this container is attached to. */
  networks: string[];
}

// ── Extension → Webview ──────────────────────────────────────────────────────

/**
 * Sent once when the webview first becomes visible (or after close/reopen).
 * The webview must replace its entire state with this snapshot.
 */
export interface SnapshotMessage {
  kind: 'snapshot';
  /**
   * Human-readable label for the connected engine,
   * e.g. "unix:/var/run/docker.sock" or "tcp://localhost:2375".
   */
  engine: string;
  /** All containers (running and stopped) at the time of the snapshot. */
  containers: ContainerInfo[];
}

/**
 * Incremental update dispatched after individual Docker events arrive.
 * All three arrays are always present (may be empty).
 */
export interface PatchMessage {
  kind: 'patch';
  added: ContainerInfo[];
  updated: ContainerInfo[];
  /** Container IDs that were destroyed. */
  removed: string[];
}

/**
 * Sent when the extension fails to connect to or query Docker.
 * The webview should surface this in a visible diagnostic header.
 */
export interface ErrorMessage {
  kind: 'error';
  message: string;
}

export type ExtensionToWebviewMessage =
  | SnapshotMessage
  | PatchMessage
  | ErrorMessage;

// ── Webview → Extension ──────────────────────────────────────────────────────

/**
 * Sent when the user triggers a container lifecycle action from the canvas.
 * (start / stop / restart via right-click menu — planned for v0.2)
 */
export interface ActionMessage {
  kind: 'action';
  action: 'start' | 'stop' | 'restart';
  containerId: string;
}

export type WebviewToExtensionMessage = ActionMessage;
