# Docker Canvas

A VS Code extension that draws every container on your Docker engine as an icon on a
pannable, zoomable canvas — live — and lets you start, stop, and restart them from a
native right-click menu.

Running containers are full colour; stopped ones are dimmed and greyscale.
Containers are grouped by Compose project so you can see which services form one stack
and which of them is down.

<!-- Replace this comment with a GIF of the canvas responding to a `docker stop` -->

## Features

- **Live canvas** — updates within ~1 s of `docker start`, `docker stop`, `docker create`,
  or `docker rm`; no manual refresh needed.
- **Compose grouping** — containers from the same Compose project are grouped under a
  collapsible header. Large groups collapse automatically on first open.
- **Right-click actions** — start, stop, and restart containers directly from the canvas.
- **Layout persistence** — drag a container to a new position and it stays there across
  reloads, keyed by container name so positions survive container recreate.
- **Auto-layout** — dagre arranges containers automatically on first open or after Reset Layout.
- **Empty states** — clear guidance when Docker is not running or the socket is
  permission-denied, with concrete next steps.

## Requirements

- Docker Desktop (Windows / macOS) **or** the Docker daemon (Linux)
- VS Code 1.85 or later

> **Platform note:** Smoke-tested on Windows with Docker Desktop (named-pipe transport).
> macOS and Linux verification is pending; do not assume those paths are confirmed until
> this note is removed.

## Running it locally

From a clone, either press `F5` (launches an Extension Development Host via
`.vscode/launch.json`), or build and install a package into your own VS Code:

```sh
npm install
npm run build
npx @vscode/vsce package --no-dependencies
code --install-extension docker-canvas-0.1.0.vsix
```

Then run **Docker Canvas: Open** from the command palette.
Remove it again with `code --uninstall-extension legion.docker-canvas`.

## Commands

| Command | Description |
|---|---|
| `Docker Canvas: Open` | Open or reveal the canvas panel |
| `Docker Canvas: List Containers` | Print a container table to the Output channel |
| `Docker Canvas: Reset Layout` | Discard saved positions and re-run auto-layout |

## Connection resolution

The extension resolves the Docker endpoint in this order:

1. `DOCKER_HOST` environment variable
2. Active Docker context (`~/.docker/config.json`)
3. Platform default — `/var/run/docker.sock` on Linux/macOS,
   `//./pipe/docker_engine` on Windows

## Architecture

All Docker access and all state live in the **extension host**. The webview is a pure
renderer: it receives a snapshot on load and incremental patches thereafter, and never
calls the Docker API directly.

```
extension host (Node.js)          webview (React)
───────────────────────           ───────────────
dockerode ─► state mirror ─► postMessage ─► React Flow canvas
                           ◄─ positionUpdate ◄─ drag end
workspaceState ◄──────────── positionUpdate
```

## Publishing

The `publish` workflow (`.github/workflows/publish.yml`) fires on a version tag push
and publishes to both the VS Code Marketplace and Open VSX.

```sh
git tag v0.1.0
git push origin v0.1.0
```

Required repository secrets: `VSCE_PAT` (VS Code Marketplace PAT) and
`OVSX_TOKEN` (Open VSX access token). See the workflow file for details.

## Licence

MIT
