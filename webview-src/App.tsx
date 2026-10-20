import { useState, useEffect, useCallback, type MouseEvent } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ContainerNode from './ContainerNode';
import ComposeGroupNode, { type ComposeGroupNodeData } from './ComposeGroupNode';
import type { ContainerInfo, ExtensionToWebviewMessage } from '../src/protocol';

// @xyflow/react v12 requires node data to extend Record<string, unknown>.
type ContainerNodeData = ContainerInfo & Record<string, unknown>;
type CanvasNode = Node<Record<string, unknown>>;

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

// ── Node layout ───────────────────────────────────────────────────────────────

/**
 * Builds the full React Flow node array from the container list and the current
 * set of collapsed compose project names.
 *
 * Layout order:
 *   1. Ungrouped containers (no compose project) — standard grid
 *   2. Compose groups — each prefixed by a header node; collapsed groups omit
 *      their container children
 */
function buildNodes(containers: ContainerInfo[], collapsedGroups: Set<string>): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  let currentY = 24;

  // 1. Ungrouped
  const ungrouped = containers.filter((c) => !c.composeProject);
  ungrouped.forEach((c, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    nodes.push({
      id: c.id,
      type: 'container',
      position: {
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

    // Group header node
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
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        nodes.push({
          id: c.id,
          type: 'container',
          position: {
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

// ── Canvas (inner — uses useReactFlow which requires ReactFlowProvider) ────────

interface CanvasProps {
  onEngine(engine: string): void;
  onError(error: string | null): void;
}

function Canvas({ onEngine, onError }: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, , onEdgesChange] = useEdgesState([]);
  const { fitView } = useReactFlow();

  /** Source-of-truth container list, kept in sync with Docker events. */
  const [containers, setContainers] = useState<ContainerInfo[]>([]);

  /**
   * Set of compose project names whose groups are currently collapsed.
   * Auto-initialised from the snapshot: projects with >= COLLAPSE_THRESHOLD
   * containers start collapsed.
   */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Rebuild React Flow nodes whenever the container list or collapse state changes.
  useEffect(() => {
    setNodes(buildNodes(containers, collapsedGroups));
  }, [containers, collapsedGroups, setNodes]);

  // Handle messages from the extension host.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtensionToWebviewMessage;

      if (msg.kind === 'snapshot') {
        onEngine(msg.engine);
        onError(null);

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
            next = [...next, ...msg.added];
          }

          return next;
        });
      } else if (msg.kind === 'error') {
        onError(msg.message);
      }
    };

    window.addEventListener('message', handler);
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

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
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
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Header engine={engine} error={error} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactFlowProvider>
          <Canvas onEngine={setEngine} onError={setError} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
