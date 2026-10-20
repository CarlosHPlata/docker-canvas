import * as vscode from 'vscode';
import Docker from 'dockerode';
import { resolveDockerOptions } from './dockerResolver';
import type {
  ContainerInfo,
  ContainerState,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from './protocol';

export class CanvasPanel implements vscode.Disposable {
  public static currentPanel: CanvasPanel | undefined;
  private static readonly viewType = 'dockerCanvas';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _disposables: vscode.Disposable[] = [];
  private _eventsStream: NodeJS.ReadableStream | undefined;

  // ── Factory ───────────────────────────────────────────────────────────────

  public static async createOrShow(extensionUri: vscode.Uri): Promise<void> {
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

    CanvasPanel.currentPanel = new CanvasPanel(panel, extensionUri);
  }

  // ── Constructor ───────────────────────────────────────────────────────────

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

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

    // Send the initial snapshot
    void this._sendSnapshot();
  }

  // ── Docker interaction ────────────────────────────────────────────────────

  private async _sendSnapshot(): Promise<void> {
    this._stopEventStream();

    let opts: Awaited<ReturnType<typeof resolveDockerOptions>>;
    try {
      opts = await resolveDockerOptions();
    } catch (err) {
      this._post({
        kind: 'error',
        message: `Failed to resolve Docker connection: ${String(err)}`,
      });
      return;
    }

    const docker = new Docker(opts);

    let rawList: Docker.ContainerInfo[];
    try {
      rawList = await docker.listContainers({ all: true });
    } catch (err) {
      this._post({
        kind: 'error',
        message: `Docker API error: ${String(err)}`,
      });
      return;
    }

    const containers: ContainerInfo[] = rawList.map((c) => ({
      id: c.Id,
      name: (c.Names[0] ?? '').replace(/^\//, ''),
      image: c.Image,
      state: c.State as ContainerState,
    }));

    this._post({
      kind: 'snapshot',
      engine: this._describeEngine(opts),
      containers,
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

      stream.on('data', (chunk: Buffer) => {
        let event: { Action: string; id: string };
        try {
          event = JSON.parse(chunk.toString()) as typeof event;
        } catch {
          return;
        }
        void this._handleDockerEvent(docker, event);
      });

      stream.on('error', () => this._stopEventStream());
      stream.on('end', () => {
        this._eventsStream = undefined;
      });
    } catch {
      // Docker events unavailable — canvas will not update live, but snapshot is shown
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

  private async _handleDockerEvent(
    docker: Docker,
    event: { Action: string; id: string },
  ): Promise<void> {
    const { Action: action, id } = event;

    if (action === 'destroy') {
      this._post({ kind: 'patch', added: [], updated: [], removed: [id] });
      return;
    }

    const watched = [
      'create',
      'start',
      'stop',
      'die',
      'pause',
      'unpause',
      'rename',
    ] as const;
    if (!(watched as readonly string[]).includes(action)) return;

    try {
      const info = await docker.getContainer(id).inspect();
      const containerInfo: ContainerInfo = {
        id: info.Id,
        name: info.Name.replace(/^\//, ''),
        image: info.Config.Image,
        state: info.State.Status as ContainerState,
      };

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
    } catch {
      // Container disappeared between event and inspect — ignore
    }
  }

  // ── Webview messages ──────────────────────────────────────────────────────

  private _handleWebviewMessage(_msg: WebviewToExtensionMessage): void {
    // Container lifecycle actions (start / stop / restart) — planned for v0.2
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
    this._stopEventStream();
    CanvasPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }
}

function getNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length)),
  ).join('');
}
