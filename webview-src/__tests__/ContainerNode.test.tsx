import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ContainerNode from '../ContainerNode';
import type { ContainerInfo } from '../../src/protocol';

// Handle and Position are the only runtime values ContainerNode uses from
// @xyflow/react; mock them so the component renders without the full
// React Flow provider stack.
vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}));

/** Render ContainerNode with the minimum required ContainerInfo fields. */
function renderNode(partial: Partial<ContainerInfo> = {}) {
  const data: ContainerInfo = {
    id: 'abc123',
    name: 'test-container',
    image: 'nginx:latest',
    state: 'running',
    health: 'none',
    networks: [],
    ...partial,
  };
  // ContainerNode expects a full NodeProps object; only `data` is read at
  // runtime, so cast the rest away.
  return render(<ContainerNode {...({ data } as unknown as Parameters<typeof ContainerNode>[0])} />);
}

describe('ContainerNode', () => {
  it('renders the container name', () => {
    renderNode();
    expect(screen.getByText('test-container')).toBeTruthy();
  });

  it('renders the container image', () => {
    renderNode();
    expect(screen.getByText('nginx:latest')).toBeTruthy();
  });

  it('is dimmed and greyscale when the container is not running', () => {
    const { container } = renderNode({ state: 'exited' });
    const root = container.firstChild as HTMLElement;
    expect(root.style.filter).toBe('grayscale(1)');
    expect(root.style.opacity).toBe('0.55');
  });

  it('is full-colour and opaque when the container is running', () => {
    const { container } = renderNode({ state: 'running' });
    const root = container.firstChild as HTMLElement;
    expect(root.style.filter).toBe('none');
    expect(parseFloat(root.style.opacity)).toBe(1);
  });

  it('is not dimmed when the container is restarting', () => {
    const { container } = renderNode({ state: 'restarting' });
    const root = container.firstChild as HTMLElement;
    expect(root.style.filter).toBe('none');
    expect(parseFloat(root.style.opacity)).toBe(1);
  });

  it('shows a pending badge when an action is in flight', () => {
    renderNode({ pending: 'stop' });
    expect(screen.getByText('stop…')).toBeTruthy();
  });

  it('shows no pending badge when no action is in flight', () => {
    renderNode();
    expect(screen.queryByText(/…/)).toBeNull();
  });

  it('shows the unhealthy badge for unhealthy containers', () => {
    renderNode({ health: 'unhealthy' });
    expect(screen.getByText('unhealthy')).toBeTruthy();
  });

  it('does not show the unhealthy badge for healthy containers', () => {
    renderNode({ health: 'healthy' });
    expect(screen.queryByText('unhealthy')).toBeNull();
  });
});
