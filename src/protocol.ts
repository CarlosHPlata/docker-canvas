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
  /**
   * Optimistic pending action badge. Set by the extension host immediately
   * after a start/stop/restart command; cleared when the resulting Docker
   * event arrives or on error.
   */
  pending?: 'start' | 'stop' | 'restart';
}

/** Persisted canvas position for a container, keyed by container name. */
export interface CanvasPosition {
  x: number;
  y: number;
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
  /**
   * Saved canvas positions keyed by container *name* (stable across recreates).
   * A container with no entry here gets a dagre-computed position.
   */
  positions: Record<string, CanvasPosition>;
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
 * The webview should surface this as a full empty-state, not just a banner.
 */
export interface ErrorMessage {
  kind: 'error';
  /**
   * Machine-readable category so the webview can show the right empty state.
   *  - 'no_engine'   : Docker daemon not reachable (ENOENT, ECONNREFUSED, …)
   *  - 'permission'  : Socket exists but access was denied (EACCES)
   *  - 'unknown'     : Any other error
   */
  errorKind: 'no_engine' | 'permission' | 'unknown';
  message: string;
}

/**
 * Sent by the extension when the user runs "Docker Canvas: Reset layout".
 * The webview discards all saved positions and re-runs dagre.
 */
export interface ResetLayoutMessage {
  kind: 'resetLayout';
}

export type ExtensionToWebviewMessage =
  | SnapshotMessage
  | PatchMessage
  | ErrorMessage
  | ResetLayoutMessage;

// ── Webview → Extension ──────────────────────────────────────────────────────

/**
 * Sent when the user triggers a container lifecycle action from the canvas.
 * In practice the VS Code native webview/context menu invokes the registered
 * command directly in the extension host; this message type is retained as a
 * fallback for webview-initiated actions.
 */
export interface ActionMessage {
  kind: 'action';
  action: 'start' | 'stop' | 'restart';
  containerId: string;
}

/**
 * Sent when the user finishes dragging a container node on the canvas.
 * The extension host persists this in workspaceState keyed by container name.
 */
export interface PositionUpdateMessage {
  kind: 'positionUpdate';
  /** Container name (not ID — stable across container recreate). */
  name: string;
  x: number;
  y: number;
}

export type WebviewToExtensionMessage = ActionMessage | PositionUpdateMessage;
