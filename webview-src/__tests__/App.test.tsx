import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ContainerInfo, SnapshotMessage, PatchMessage, ErrorMessage } from '../../src/protocol';

// ── Mock @xyflow/react ────────────────────────────────────────────────────────
//
// The full React Flow library requires browser APIs (ResizeObserver, SVG
// measurements) that jsdom does not provide.  We replace it with a minimal
// stub that:
//   • wires up the useState-backed hooks so Canvas state changes fire normally
//   • renders each node via its registered nodeType component so ContainerNode
//     and ComposeGroupNode appear in the DOM and can be queried
//   • keeps Handle / Position so ContainerNode compiles without errors

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  const { useState } = React;

  function ReactFlow({ nodes, nodeTypes }: {
    nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>;
    nodeTypes?: Record<string, React.ComponentType<{ id: string; type?: string; data: Record<string, unknown>; selected: boolean; isConnectable: boolean; zIndex: number; xPos: number; yPos: number; dragging: boolean; positionAbsoluteX: number; positionAbsoluteY: number }>>;
    [key: string]: unknown;
  }) {
    return React.createElement(
      'div',
      { 'data-testid': 'react-flow' },
      nodes.map((node) => {
        const NodeComp = nodeTypes?.[node.type ?? ''];
        if (!NodeComp) return null;
        return React.createElement(NodeComp as React.ComponentType<Record<string, unknown>>, {
          key: node.id,
          id: node.id,
          type: node.type,
          data: node.data,
          selected: false,
          isConnectable: false,
          zIndex: 0,
          xPos: 0,
          yPos: 0,
          dragging: false,
          positionAbsoluteX: 0,
          positionAbsoluteY: 0,
        });
      }),
    );
  }

  function ReactFlowProvider({ children }: { children: React.ReactNode }) {
    return React.createElement(React.Fragment, null, children);
  }

  return {
    ReactFlow,
    ReactFlowProvider,
    Background: () => null,
    Controls: () => null,
    BackgroundVariant: { Dots: 'dots' },
    Handle: () => null,
    Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
    useNodesState: (initial: unknown[]) => {
      const [nodes, setNodes] = useState(initial);
      return [nodes, setNodes, () => {}] as const;
    },
    useEdgesState: (initial: unknown[]) => {
      const [edges, setEdges] = useState(initial);
      return [edges, setEdges, () => {}] as const;
    },
    useReactFlow: () => ({ fitView: () => {} }),
  };
});

// ── Mock @dagrejs/dagre ───────────────────────────────────────────────────────
//
// dagre's layout algorithm is a no-op in tests; nodes get a fixed position.

vi.mock('@dagrejs/dagre', () => {
  class Graph {
    private _nodes = new Map<string, { x: number; y: number; width: number; height: number }>();
    setDefaultEdgeLabel() {}
    setGraph() {}
    setNode(id: string, data: { width: number; height: number }) {
      this._nodes.set(id, { x: 100, y: 100, ...data });
    }
    node(id: string) {
      return this._nodes.get(id) ?? { x: 100, y: 100, width: 240, height: 70 };
    }
  }
  return {
    default: {
      graphlib: { Graph },
      layout: () => {},
    },
  };
});

// App is imported AFTER the mocks above so module-level acquireVsCodeApi()
// (called in App.tsx) finds the stub from vitest-setup.ts.
import App from '../App';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContainer(partial: Partial<ContainerInfo>): ContainerInfo {
  return {
    id: `id-${Math.random().toString(36).slice(2)}`,
    name: 'test-container',
    image: 'nginx:latest',
    state: 'running',
    health: 'none',
    networks: [],
    ...partial,
  };
}

function dispatch(data: SnapshotMessage | PatchMessage | ErrorMessage) {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('App — snapshot message', () => {
  beforeEach(() => {
    // Each test gets a fresh DOM
  });

  it('produces a node for every container in the snapshot, including stopped ones', async () => {
    render(<App />);

    const running = makeContainer({ id: 'r1', name: 'running-box', state: 'running' });
    const stopped = makeContainer({ id: 's1', name: 'stopped-box', state: 'exited' });

    await act(async () => {
      dispatch({
        kind: 'snapshot',
        engine: 'unix:/var/run/docker.sock',
        containers: [running, stopped],
        positions: {},
      });
    });

    // Both names must appear — stopped containers must NOT be filtered out.
    expect(screen.getByText('running-box')).toBeTruthy();
    expect(screen.getByText('stopped-box')).toBeTruthy();
  });

  it('groups containers that share a compose project under a ComposeGroupNode', async () => {
    render(<App />);

    await act(async () => {
      dispatch({
        kind: 'snapshot',
        engine: 'docker',
        containers: [
          makeContainer({ id: 'a1', name: 'web', state: 'running', composeProject: 'myapp' }),
          makeContainer({ id: 'a2', name: 'db', state: 'running', composeProject: 'myapp' }),
        ],
        positions: {},
      });
    });

    // The ComposeGroupNode header should show the project name and member count.
    expect(screen.getByText('myapp')).toBeTruthy();
    expect(screen.getByText('2 containers')).toBeTruthy();
  });
});

describe('App — patch message', () => {
  it('updates an existing node state without duplicating it', async () => {
    render(<App />);

    const container = makeContainer({ id: 'c1', name: 'my-service', state: 'running' });

    // Seed with a snapshot first.
    await act(async () => {
      dispatch({
        kind: 'snapshot',
        engine: 'docker',
        containers: [container],
        positions: {},
      });
    });

    // Now send a patch that changes the container state.
    await act(async () => {
      dispatch({
        kind: 'patch',
        added: [],
        updated: [{ ...container, state: 'exited' }],
        removed: [],
      });
    });

    // The name should appear exactly once (no duplication).
    expect(screen.getAllByText('my-service')).toHaveLength(1);
    // The updated state should be visible.
    expect(screen.getByText('exited')).toBeTruthy();
  });
});

describe('App — error message', () => {
  it('surfaces a no_engine error in the empty state', async () => {
    render(<App />);

    await act(async () => {
      dispatch({
        kind: 'error',
        errorKind: 'no_engine',
        message: 'Cannot connect to Docker daemon at /var/run/docker.sock',
      });
    });

    // The EmptyState component renders a title matching the errorKind.
    expect(screen.getByText('No Docker engine reachable')).toBeTruthy();
  });

  it('surfaces a permission error in the empty state', async () => {
    render(<App />);

    await act(async () => {
      dispatch({
        kind: 'error',
        errorKind: 'permission',
        message: 'Permission denied: /var/run/docker.sock',
      });
    });

    expect(screen.getByText('Permission denied')).toBeTruthy();
  });
});
