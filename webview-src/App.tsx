import { useState, useEffect, useCallback, useRef, type MouseEvent } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import ContainerNode from './ContainerNode';
import ComposeGroupNode, { type ComposeGroupNodeData } from './ComposeGroupNode';
import type {
  CanvasPosition,
  ContainerInfo,
  ExtensionToWebviewMessage,
  PositionUpdateMessage,
  ReadyMessage,
} from '../src/protocol';

// @xyflow/react v12 requires node data to extend Record<string, unknown>.
type ContainerNodeData = ContainerInfo & Record<string, unknown>;
type CanvasNode = Node<Record<string, unknown>>;

const vscode = acquireVsCodeApi();

// ── Layout constants ──────────────────────────────────────────────────────────

const CARD_W = 240;
const CARD_H = 70;
const COLS = 4;
const GAP_X = 40;
const GAP_Y = 40;
const GROUP_HEADER_H = 32;
const GROUP_HEADER_GAP = 8;

/**
 * Compose groups with this many or more containers collapse by default so
 * large hosts (100+ containers) render without an overwhelming initial layout.
 */
const COLLAPSE_THRESHOLD = 4;

// ── Dagre auto-layout ─────────────────────────────────────────────────────────

/**
 * Compute positions for all container nodes using dagre.
 * Only called when there are no saved positions (first open or after reset).
 * Returns a map of container name → {x, y}.
 */
function computeDagreLayout(containers: ContainerInfo[]): Record<string, XYPosition> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: GAP_Y, ranksep: GAP_X * 2, marginx: 24, marginy: 24 });

  for (const c of containers) {
    g.setNode(c.name, { width: CARD_W, height: CARD_H });
  }

  dagre.layout(g);

  const positions: Record<string, XYPosition> = {};
  for (const c of containers) {
    const node = g.node(c.name);
    if (node) {
      // dagre gives centre coordinates; React Flow uses top-left
      positions[c.name] = { x: node.x - CARD_W / 2, y: node.y - CARD_H / 2 };
    }
  }
  return positions;
}

// ── Node layout ───────────────────────────────────────────────────────────────

/**
 * Builds the full React Flow node array from the container list, the current
 * set of collapsed compose project names, and the saved canvas positions.
 *
 * For nodes with a saved position that position is used directly.
 * Nodes without a saved position fall back to the grid layout.
 *
 * Layout order (for the grid fallback):
 *   1. Ungrouped containers (no compose project)
 *   2. Compose groups — each prefixed by a header node
 */
function buildNodes(
  containers: ContainerInfo[],
  collapsedGroups: Set<string>,
  savedPositions: Record<string, CanvasPosition>,
): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  let currentY = 24;

  // 1. Ungrouped
  const ungrouped = containers.filter((c) => !c.composeProject);
  ungrouped.forEach((c, i) => {
    const saved = savedPositions[c.name];
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    nodes.push({
      id: c.id,
      type: 'container',
      position: saved ?? {
        x: 24 + col * (CARD_W + GAP_X),
        y: currentY + row * (CARD_H + GAP_Y),
      },
      data: c as ContainerNodeData,
    });
  });

  if (ungrouped.length > 0) {
    currentY += Math.ceil(ungrouped.length / COLS) * (CARD_H + GAP_Y) + GAP_Y;
  }

  // 2. Compose groups — ordered by project name for stable layout
  const grouped = new Map<string, ContainerInfo[]>();
  for (const c of containers) {
    if (c.composeProject) {
      const list = grouped.get(c.composeProject) ?? [];
      list.push(c);
      grouped.set(c.composeProject, list);
    }
  }

  const sortedProjects = [...grouped.keys()].sort();
  for (const project of sortedProjects) {
    const members = grouped.get(project)!;
    const collapsed = collapsedGroups.has(project);

    // Group header node — always at the grid position (not persisted)
    nodes.push({
      id: `group:${project}`,
      type: 'composeGroup',
      position: { x: 24, y: currentY },
      data: { project, count: members.length, collapsed } satisfies ComposeGroupNodeData,
      draggable: false,
      selectable: false,
    });
    currentY += GROUP_HEADER_H + GROUP_HEADER_GAP;

    if (!collapsed) {
      members.forEach((c, i) => {
        const saved = savedPositions[c.name];
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        nodes.push({
          id: c.id,
          type: 'container',
          position: saved ?? {
            x: 24 + col * (CARD_W + GAP_X),
            y: currentY + row * (CARD_H + GAP_Y),
          },
          data: c as ContainerNodeData,
        });
      });
      currentY += Math.ceil(members.length / COLS) * (CARD_H + GAP_Y) + GAP_Y;
    } else {
      currentY += GAP_Y;
    }
  }

  return nodes;
}

// ── Node type registry (stable reference, defined outside render) ─────────────

const nodeTypes = {
  container: ContainerNode,
  composeGroup: ComposeGroupNode,
};

// ── Header ────────────────────────────────────────────────────────────────────

interface HeaderProps {
  engine: string;
  error: string | null;
}

function Header({ engine, error }: HeaderProps) {
  return (
    <div
      style={{
        flexShrink: 0,
        padding: '5px 12px',
        borderBottom: '1px solid var(--vscode-editorGroup-border, #3c3c3c)',
        background: 'var(--vscode-editorGroupHeader-tabsBackground, #252526)',
        fontSize: 12,
        display: 'flex',
        gap: 16,
        alignItems: 'center',
      }}
    >
      <strong style={{ letterSpacing: '0.02em' }}>Docker Canvas</strong>

      {engine && (
        <span style={{ opacity: 0.75 }}>
          Engine:{' '}
          <code
            style={{
              fontSize: 11,
              background: 'var(--vscode-textCodeBlock-background, #1e1e1e)',
              padding: '1px 4px',
              borderRadius: 3,
            }}
          >
            {engine}
          </code>
        </span>
      )}

      {error && (
        <span
          style={{
            color: 'var(--vscode-errorForeground, #f48771)',
            fontStyle: 'italic',
          }}
        >
          ⚠ {error}
        </span>
      )}

      {!engine && !error && (
        <span style={{ opacity: 0.45 }}>Connecting…</span>
      )}
    </div>
  );
}

// ── Empty states ──────────────────────────────────────────────────────────────

interface EmptyStateProps {
  errorKind: 'no_engine' | 'permission' | 'unknown';
  message: string;
}

function EmptyState({ errorKind, message }: EmptyStateProps) {
  const title =
    errorKind === 'permission'
      ? 'Permission denied'
      : errorKind === 'no_engine'
      ? 'No Docker engine reachable'
      : 'Docker error';

  const hint =
    errorKind === 'permission' ? (
      <>
        Your user cannot access the Docker socket.
        <br />
        Run{' '}
        <code style={{ fontSize: 12, background: 'var(--vscode-textCodeBlock-background, #1e1e1e)', padding: '1px 4px', borderRadius: 3 }}>
          sudo usermod -aG docker $USER
        </code>{' '}
        then log out and back in (or{' '}
        <code style={{ fontSize: 12, background: 'var(--vscode-textCodeBlock-background, #1e1e1e)', padding: '1px 4px', borderRadius: 3 }}>
          newgrp docker
        </code>
        ).
      </>
    ) : errorKind === 'no_engine' ? (
      <>
        Docker Desktop (or the Docker daemon) does not appear to be running.
        <br />
        Start Docker and the canvas will reconnect automatically.
      </>
    ) : (
      <>Retrying…</>
    );

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 32,
        color: 'var(--vscode-editor-foreground, #d4d4d4)',
        opacity: 0.75,
        textAlign: 'center',
      }}
    >
      <span style={{ fontSize: 36 }}>{errorKind === 'permission' ? '🔒' : '🐳'}</span>
      <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
      <div style={{ fontSize: 12, maxWidth: 420, lineHeight: 1.6 }}>{hint}</div>
      <div
        style={{
          fontSize: 11,
          opacity: 0.5,
          fontFamily: 'monospace',
          maxWidth: 560,
          wordBreak: 'break-all',
          marginTop: 4,
        }}
      >
        {message}
      </div>
    </div>
  );
}

// ── Canvas (inner — uses useReactFlow which requires ReactFlowProvider) ────────

interface CanvasProps {
  onEngine(engine: string): void;
  onError(kind: 'no_engine' | 'permission' | 'unknown' | null, message: string | null): void;
}

function Canvas({ onEngine, onError }: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, , onEdgesChange] = useEdgesState([]);
  const { fitView } = useReactFlow();

  /** Source-of-truth container list, kept in sync with Docker events. */
  const [containers, setContainers] = useState<ContainerInfo[]>([]);

  /**
   * Canvas positions keyed by container name.
   * Seeded from the snapshot, updated on drag-end, cleared on reset.
   */
  const [savedPositions, setSavedPositions] = useState<Record<string, CanvasPosition>>({});

  /** Track whether we've applied dagre on this snapshot (avoid re-running on re-renders). */
  const dagreAppliedRef = useRef(false);

  /**
   * Set of compose project names whose groups are currently collapsed.
   * Auto-initialised from the snapshot: projects with >= COLLAPSE_THRESHOLD
   * containers start collapsed.
   */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Rebuild React Flow nodes whenever the container list, collapse state, or positions change.
  useEffect(() => {
    setNodes(buildNodes(containers, collapsedGroups, savedPositions));
  }, [containers, collapsedGroups, savedPositions, setNodes]);

  // Handle messages from the extension host.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtensionToWebviewMessage;

      if (msg.kind === 'snapshot') {
        onEngine(msg.engine);
        onError(null, null);

        // Initialise collapsed groups: any project with >= COLLAPSE_THRESHOLD
        // containers starts collapsed.
        const projectCounts = new Map<string, number>();
        for (const c of msg.containers) {
          if (c.composeProject) {
            projectCounts.set(
              c.composeProject,
              (projectCounts.get(c.composeProject) ?? 0) + 1,
            );
          }
        }
        const initialCollapsed = new Set<string>();
        for (const [project, count] of projectCounts.entries()) {
          if (count >= COLLAPSE_THRESHOLD) {
            initialCollapsed.add(project);
          }
        }
        setCollapsedGroups(initialCollapsed);

        // Determine effective positions: use saved positions from workspaceState,
        // or fall back to dagre for containers with no saved position.
        const hasAnySaved = Object.keys(msg.positions).length > 0;
        let effectivePositions: Record<string, CanvasPosition>;

        if (hasAnySaved) {
          effectivePositions = msg.positions;
          dagreAppliedRef.current = true;
        } else {
          // First open or after reset: run dagre off the main render path.
          const dagrePositions = computeDagreLayout(msg.containers);
          effectivePositions = dagrePositions;
          dagreAppliedRef.current = true;
        }

        setSavedPositions(effectivePositions);
        setContainers(msg.containers);

        requestAnimationFrame(() => {
          fitView({ padding: 0.15, duration: 250 });
        });
      } else if (msg.kind === 'patch') {
        setContainers((prev) => {
          let next = [...prev];

          if (msg.removed.length > 0) {
            const rm = new Set(msg.removed);
            next = next.filter((c) => !rm.has(c.id));
          }

          if (msg.updated.length > 0) {
            const um = new Map(msg.updated.map((c) => [c.id, c]));
            next = next.map((c) => um.get(c.id) ?? c);
          }

          if (msg.added.length > 0) {
            // New containers get a dagre-computed position relative to existing ones
            setSavedPositions((prev) => {
              const withNew = { ...prev };
              for (const c of msg.added) {
                if (!withNew[c.name]) {
                  // Place new containers below the existing layout
                  const existingYValues = Object.values(withNew).map((p) => p.y);
                  const maxY = existingYValues.length > 0 ? Math.max(...existingYValues) : 0;
                  withNew[c.name] = { x: 24, y: maxY + CARD_H + GAP_Y };
                }
              }
              return withNew;
            });
            next = [...next, ...msg.added];
          }

          return next;
        });
      } else if (msg.kind === 'error') {
        onError(msg.errorKind, msg.message);
      } else if (msg.kind === 'resetLayout') {
        dagreAppliedRef.current = false;
        setSavedPositions({});
        // buildNodes will run with empty positions — dagre will be applied on next snapshot
        // but for an immediate reset we run dagre on current containers
        setContainers((current) => {
          if (current.length > 0) {
            const dagrePositions = computeDagreLayout(current);
            setSavedPositions(dagrePositions);
          }
          requestAnimationFrame(() => {
            fitView({ padding: 0.15, duration: 250 });
          });
          return current;
        });
      }
    };

    window.addEventListener('message', handler);

    // Tell the host we are listening. Until this arrives the host sends nothing,
    // because messages posted to a loading webview are dropped on the floor.
    vscode.postMessage({ kind: 'ready' } satisfies ReadyMessage);

    return () => window.removeEventListener('message', handler);
  }, [fitView, onEngine, onError]);

  // Toggle collapse state when a composeGroup node is clicked.
  const handleNodeClick = useCallback(
    (_event: MouseEvent, node: CanvasNode) => {
      if (node.type === 'composeGroup') {
        const project = (node.data as ComposeGroupNodeData).project;
        setCollapsedGroups((prev) => {
          const next = new Set(prev);
          if (next.has(project)) next.delete(project);
          else next.add(project);
          return next;
        });
      }
    },
    [],
  );

  // Persist positions after a drag ends.
  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      onNodesChange(changes);
      for (const change of changes) {
        if (change.type === 'position' && change.dragging === false && change.position) {
          // Find the container name for this node ID
          const node = nodes.find((n) => n.id === change.id);
          if (!node || node.type !== 'container') continue;
          const containerInfo = node.data as ContainerNodeData;
          const name = containerInfo.name as string;
          if (!name) continue;

          const pos = change.position;
          setSavedPositions((prev) => ({ ...prev, [name]: pos }));

          const msg: PositionUpdateMessage = {
            kind: 'positionUpdate',
            name,
            x: pos.x,
            y: pos.y,
          };
          vscode.postMessage(msg);
        }
      }
    },
    [nodes, onNodesChange],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={handleNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      deleteKeyCode={null}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1}
        color="var(--vscode-editorIndentGuide-background, #404040)"
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [engine, setEngine] = useState('');
  const [errorState, setErrorState] = useState<{
    kind: 'no_engine' | 'permission' | 'unknown';
    message: string;
  } | null>(null);

  const handleError = useCallback(
    (kind: 'no_engine' | 'permission' | 'unknown' | null, message: string | null) => {
      if (kind === null) {
        setErrorState(null);
      } else {
        setErrorState({ kind, message: message ?? '' });
      }
    },
    [],
  );

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Header engine={engine} error={errorState ? errorState.message : null} />
      {errorState ? (
        <EmptyState errorKind={errorState.kind} message={errorState.message} />
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <ReactFlowProvider>
            <Canvas onEngine={setEngine} onError={handleError} />
          </ReactFlowProvider>
        </div>
      )}
    </div>
  );
}
