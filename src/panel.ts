import * as vscode from 'vscode';
import Docker from 'dockerode';
import { resolveDockerOptions } from './dockerResolver';
import { isWatchedAction, parseEventChunk, type ParsedDockerEvent } from './dockerEvents';
import type {
  CanvasPosition,
  ContainerHealth,
  ContainerInfo,
  ContainerState,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from './protocol';

const POSITIONS_KEY = 'dockerCanvas.positions';

export class CanvasPanel implements vscode.Disposable {
  public static currentPanel: CanvasPanel | undefined;
  private static readonly viewType = 'dockerCanvas';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _workspaceState: vscode.Memento;
  private readonly _disposables: vscode.Disposable[] = [];
  private _eventsStream: NodeJS.ReadableStream | undefined;
  private _reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private _reconnectDelay = 1_000; // ms; doubles on each failure, caps at MAX
  private static readonly _MAX_RECONNECT_DELAY = 30_000;

  /** Active Docker client, set after a successful connection. */
  private _docker: Docker | undefined;

  /**
   * Local mirror of the canvas state, keyed by container ID.
   * Used to build optimistic pending patches and to restore state on error.
   */
  private readonly _containerMap = new Map<string, ContainerInfo>();

  // ── Factory ───────────────────────────────────────────────────────────────

  public static async createOrShow(
    extensionUri: vscode.Uri,
    workspaceState: vscode.Memento,
  ): Promise<void> {
    const column =
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (CanvasPanel.currentPanel) {
      CanvasPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CanvasPanel.viewType,
      'Docker Canvas',
      column,
      {
        enableScripts: true,
        // The extension host owns all state; the webview is a disposable renderer.
        retainContextWhenHidden: false,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
        ],
      },
    );

    CanvasPanel.currentPanel = new CanvasPanel(panel, extensionUri, workspaceState);
  }

  // ── Constructor ───────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    workspaceState: vscode.Memento,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._workspaceState = workspaceState;

    this._panel.webview.html = this._buildHtml();

    // Clean up when the user closes the panel
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Re-hydrate with a fresh snapshot whenever the webview context is recreated
    // (fires each time the panel tab becomes visible with retainContextWhenHidden: false)
    this._panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.visible) {
          void this._sendSnapshot();
        }
      },
      null,
      this._disposables,
    );

    // Handle messages sent from the webview
    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtensionMessage) => this._handleWebviewMessage(msg),
      null,
      this._disposables,
    );

    // No snapshot is sent here on purpose. The webview bundle is still loading at
    // this point and VS Code drops messages posted to a webview that has not yet
    // attached its message listener. The webview sends `ready` when it is
    // listening, and that is what triggers the first snapshot.
  }

  // ── Public action API (called by VS Code webview/context commands) ─────────

  /**
   * Starts, stops, or restarts a container.
   *
   * Flow:
   * 1. Post an optimistic `patch` with `pending` set so the webview shows a badge.
   * 2. Call the Docker API.
   * 3. On success: the resulting Docker event arrives via the event stream and
   *    posts a fresh patch (no `pending`), clearing the badge automatically.
   * 4. On failure: post the original container info (no `pending`) to clear the
   *    badge, then show a VS Code error notification.
   */
  public async performAction(
    action: 'start' | 'stop' | 'restart',
    containerId: string,
  ): Promise<void> {
    const docker = this._docker;
    if (!docker) return;

    const original = this._containerMap.get(containerId);
    if (!original) return;

    // Optimistic pending badge
    const optimistic: ContainerInfo = { ...original, pending: action };
    this._containerMap.set(containerId, optimistic);
    this._post({ kind: 'patch', added: [], updated: [optimistic], removed: [] });

    try {
      const container = docker.getContainer(containerId);
      if (action === 'start') await container.start();
      else if (action === 'stop') await container.stop();
      else await container.restart();
      // The Docker event stream will send the authoritative state; no extra patch needed.
    } catch (err) {
      // Restore original state and surface the error.
      this._containerMap.set(containerId, original);
      this._post({ kind: 'patch', added: [], updated: [original], removed: [] });
      void vscode.window.showErrorMessage(
        `Docker Canvas: failed to ${action} "${original.name}" — ${String(err)}`,
      );
    }
  }

  /** Clears all saved positions and tells the webview to re-run dagre. */
  public async resetLayout(): Promise<void> {
    await this._workspaceState.update(POSITIONS_KEY, undefined);
    this._post({ kind: 'resetLayout' });
  }

  // ── Docker interaction ────────────────────────────────────────────────────

  private async _sendSnapshot(): Promise<void> {
    this._cancelReconnect();
    this._stopEventStream();

    let opts: Awaited<ReturnType<typeof resolveDockerOptions>>;
    try {
      opts = await resolveDockerOptions();
    } catch (err) {
      this._post({
        kind: 'error',
        errorKind: 'no_engine',
        message: `Failed to resolve Docker connection: ${String(err)}`,
      });
      this._scheduleReconnect();
      return;
    }

    const docker = new Docker(opts);

    let rawList: Docker.ContainerInfo[];
    try {
      rawList = await docker.listContainers({ all: true });
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      const errorKind =
        error.code === 'EACCES'
          ? 'permission'
          : error.code === 'ENOENT' || error.code === 'ECONNREFUSED'
          ? 'no_engine'
          : 'unknown';
      this._post({
        kind: 'error',
        errorKind,
        message: `Docker API error: ${String(err)}`,
      });
      this._scheduleReconnect();
      return;
    }

    // Store the active client so performAction can use it.
    this._docker = docker;

    const containers: ContainerInfo[] = rawList.map((c) => ({
      id: c.Id,
      name: (c.Names[0] ?? '').replace(/^\//, ''),
      image: c.Image,
      state: c.State as ContainerState,
      health: parseHealthFromStatus(c.Status),
      composeProject: c.Labels?.['com.docker.compose.project'] ?? undefined,
      networks: Object.keys(c.NetworkSettings?.Networks ?? {}),
    }));

    // Rebuild the local mirror.
    this._containerMap.clear();
    for (const c of containers) {
      this._containerMap.set(c.id, c);
    }

    const positions =
      this._workspaceState.get<Record<string, CanvasPosition>>(POSITIONS_KEY) ?? {};

    this._post({
      kind: 'snapshot',
      engine: this._describeEngine(opts),
      containers,
      positions,
    });

    void this._startEventStream(docker);
  }

  private _describeEngine(
    opts: Awaited<ReturnType<typeof resolveDockerOptions>>,
  ): string {
    if (opts.socketPath) return `unix:${opts.socketPath}`;
    if (opts.host) {
      const proto = opts.protocol ?? 'tcp';
      return `${proto}://${opts.host}:${opts.port ?? 2375}`;
    }
    return 'docker';
  }

  private async _startEventStream(docker: Docker): Promise<void> {
    try {
      const stream = (await docker.getEvents({
        filters: JSON.stringify({ type: ['container'] }),
      })) as NodeJS.ReadableStream;

      this._eventsStream = stream;
      this._reconnectDelay = 1_000; // reset backoff: connection succeeded

      stream.on('data', (chunk: Buffer) => {
        for (const event of parseEventChunk(chunk.toString())) {
          void this._handleDockerEvent(docker, event);
        }
      });

      stream.on('error', () => {
        this._stopEventStream();
        this._scheduleReconnect();
      });
      stream.on('end', () => {
        this._eventsStream = undefined;
        this._scheduleReconnect();
      });
    } catch {
      // getEvents() itself failed — schedule reconnect with backoff
      this._scheduleReconnect();
    }
  }

  private _stopEventStream(): void {
    if (this._eventsStream) {
      try {
        (
          this._eventsStream as NodeJS.ReadableStream & { destroy?(): void }
        ).destroy?.();
      } catch {
        // best effort
      }
      this._eventsStream = undefined;
    }
  }

  private _scheduleReconnect(): void {
    if (!this._panel.visible) return; // onDidChangeViewState will resync on show
    if (this._reconnectTimer !== undefined) return; // already scheduled
    const delay = this._reconnectDelay;
    this._reconnectDelay = Math.min(delay * 2, CanvasPanel._MAX_RECONNECT_DELAY);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = undefined;
      if (this._panel.visible) {
        void this._sendSnapshot();
      }
    }, delay);
  }

  private _cancelReconnect(): void {
    if (this._reconnectTimer !== undefined) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = undefined;
    }
  }

  private async _handleDockerEvent(
    docker: Docker,
    event: ParsedDockerEvent,
  ): Promise<void> {
    const { action, id } = event;

    if (action === 'destroy') {
      this._containerMap.delete(id);
      this._post({ kind: 'patch', added: [], updated: [], removed: [id] });
      return;
    }

    if (!isWatchedAction(action)) return;

    try {
      const info = await docker.getContainer(id).inspect();
      // Note: no `pending` field — this authoritative update clears any badge.
      const containerInfo: ContainerInfo = {
        id: info.Id,
        name: info.Name.replace(/^\//, ''),
        image: info.Config.Image,
        state: info.State.Status as ContainerState,
        health: (info.State.Health?.Status ?? 'none') as ContainerHealth,
        composeProject: info.Config.Labels?.['com.docker.compose.project'] ?? undefined,
        networks: Object.keys(info.NetworkSettings.Networks ?? {}),
      };

      this._containerMap.set(containerInfo.id, containerInfo);

      if (action === 'create') {
        this._post({
          kind: 'patch',
          added: [containerInfo],
          updated: [],
          removed: [],
        });
      } else {
        this._post({
          kind: 'patch',
          added: [],
          updated: [containerInfo],
          removed: [],
        });
      }
    } catch (err) {
      // Usually a benign race: the container was removed between the event and
      // the inspect. Logged rather than swallowed, because a systematic inspect
      // failure here silently freezes the canvas and is otherwise invisible.
      console.warn(`Docker Canvas: inspect failed for ${action} on ${id}:`, err);
    }
  }

  // ── Webview messages ──────────────────────────────────────────────────────

  private _handleWebviewMessage(msg: WebviewToExtensionMessage): void {
    if (msg.kind === 'ready') {
      // The webview is listening now, so state will not be dropped.
      void this._sendSnapshot();
      return;
    }

    if (msg.kind === 'positionUpdate') {
      const positions =
        this._workspaceState.get<Record<string, CanvasPosition>>(POSITIONS_KEY) ?? {};
      positions[msg.name] = { x: msg.x, y: msg.y };
      void this._workspaceState.update(POSITIONS_KEY, positions);
    }
    // ActionMessage: VS Code webview/context commands call performAction() directly in the
    // extension host; webview-initiated ActionMessages are a fallback path.
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _post(msg: ExtensionToWebviewMessage): void {
    if (this._panel.visible) {
      void this._panel.webview.postMessage(msg);
    }
  }

  private _buildHtml(): string {
    const { webview } = this._panel;
    const nonce = getNonce();

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'index.js'),
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'index.css'),
    );

    // CSP:
    //   script-src  — only our nonce'd bundle; no inline scripts
    //   style-src   — our bundled CSS file + 'unsafe-inline' for React Flow's
    //                 runtime inline styles (required by @xyflow/react)
    //   img-src     — extension resources + data URIs (React Flow SVG handles)
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'nonce-${nonce}';
    style-src ${webview.cspSource} 'unsafe-inline';
    img-src ${webview.cspSource} data:;
    font-src ${webview.cspSource};
  " />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Docker Canvas</title>
  <link rel="stylesheet" href="${cssUri}" />
  <style>
    html, body, #root {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  // ── Disposable ────────────────────────────────────────────────────────────

  public dispose(): void {
    this._cancelReconnect();
    this._stopEventStream();
    this._docker = undefined;
    this._containerMap.clear();
    CanvasPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }
}

/**
 * Derive health status from the human-readable Status string returned by
 * `docker.listContainers()`, e.g. "Up 2 hours (healthy)".
 * Inspect calls give the authoritative value; this is used for the snapshot.
 */
function parseHealthFromStatus(status: string): ContainerHealth {
  if (status.includes('(healthy)')) return 'healthy';
  if (status.includes('(unhealthy)')) return 'unhealthy';
  if (status.includes('health:')) return 'starting';
  return 'none';
}

function getNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length)),
  ).join('');
}
