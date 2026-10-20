# Docker Canvas

A VS Code extension that draws the containers on your Docker Engine as icons on a
pannable, zoomable canvas — live — and lets you start, stop and restart them from a
native right-click menu. Running containers are full colour; stopped ones are dimmed.

Containers are grouped by Compose project so you can see at a glance which services
form one stack and which of them is down.

## Status

MVP in development. See the delivery phases in the Paperclip project.

## Architecture

All Docker access and all state live in the extension host. The webview is a pure
renderer that receives patches over a typed `postMessage` protocol and never talks
to Docker directly.

- **Docker client** — `dockerode` over the local socket or named pipe, resolved from
  `DOCKER_HOST`, then the active Docker context, then the platform default.
- **State store** — container id to view model, seeded by `listContainers({ all: true })`
  and kept current by the Docker events stream.
- **Layout** — positions keyed by container name in `workspaceState`; dagre places
  anything without a saved position.

## Licence

MIT
