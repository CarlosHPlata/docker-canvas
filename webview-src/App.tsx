import { useState, useEffect } from 'react';
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
import type { ContainerInfo, ExtensionToWebviewMessage } from '../src/protocol';

// @xyflow/react v12 requires node data to extend Record<string, unknown>.
// ContainerInfo is structurally compatible at runtime; this alias adds the
// index signature TypeScript needs to satisfy the constraint.
type ContainerNodeData = ContainerInfo & Record<string, unknown>;
type ContainerFlowNode = Node<ContainerNodeData>;

// ── Layout constants ──────────────────────────────────────────────────────────

const CARD_W = 240;
const CARD_H = 70;
const COLS = 4;
const GAP_X = 40;
const GAP_Y = 40;

function makeNode(c: ContainerInfo, idx: number): ContainerFlowNode {
  const col = idx % COLS;
  const row = Math.floor(idx / COLS);
  return {
    id: c.id,
    type: 'container',
    position: {
      x: 24 + col * (CARD_W + GAP_X),
      y: 24 + row * (CARD_H + GAP_Y),
    },
    data: c as ContainerNodeData,
  };
}

// ── Node type registry (stable reference, defined outside render) ─────────────

const nodeTypes = { container: ContainerNode };

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
        background:
          'var(--vscode-editorGroupHeader-tabsBackground, #252526)',
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
  const [nodes, setNodes, onNodesChange] = useNodesState<ContainerFlowNode>([]);
  const [edges, , onEdgesChange] = useEdgesState([]);
  const { fitView } = useReactFlow();

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtensionToWebviewMessage;

      if (msg.kind === 'snapshot') {
        onEngine(msg.engine);
        onError(null);
        const newNodes = msg.containers.map(makeNode);
        setNodes(newNodes);
        // Fit after React Flow has processed the new nodes
        requestAnimationFrame(() => {
          fitView({ padding: 0.15, duration: 250 });
        });
      } else if (msg.kind === 'patch') {
        setNodes((prev) => {
          let next = [...prev];

          if (msg.removed.length > 0) {
            const rm = new Set(msg.removed);
            next = next.filter((n) => !rm.has(n.id));
          }

          if (msg.updated.length > 0) {
            const um = new Map(msg.updated.map((c) => [c.id, c]));
            next = next.map((n) => {
              const upd = um.get(n.id);
              return upd ? { ...n, data: upd as ContainerNodeData } : n;
            });
          }

          if (msg.added.length > 0) {
            const base = next.length;
            const newNodes = msg.added.map((c, i) => makeNode(c, base + i));
            next = [...next, ...newNodes];
          }

          return next;
        });
      } else if (msg.kind === 'error') {
        onError(msg.message);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [setNodes, fitView, onEngine, onError]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
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
