import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ComposeGroupNode, { type ComposeGroupNodeData } from '../ComposeGroupNode';

/** Render ComposeGroupNode with the minimum required data fields. */
function renderGroup(partial: Partial<ComposeGroupNodeData> = {}) {
  const data: ComposeGroupNodeData = {
    project: 'my-project',
    count: 3,
    collapsed: false,
    ...partial,
  };
  return render(<ComposeGroupNode {...({ data } as unknown as Parameters<typeof ComposeGroupNode>[0])} />);
}

describe('ComposeGroupNode', () => {
  it('shows the project name', () => {
    renderGroup();
    expect(screen.getByText('my-project')).toBeTruthy();
  });

  it('shows a plural container count', () => {
    renderGroup({ count: 3 });
    expect(screen.getByText('3 containers')).toBeTruthy();
  });

  it('shows a singular container count', () => {
    renderGroup({ count: 1 });
    expect(screen.getByText('1 container')).toBeTruthy();
  });

  it('shows the collapse indicator (▶) when the group is collapsed', () => {
    renderGroup({ collapsed: true });
    expect(screen.getByText('▶')).toBeTruthy();
  });

  it('shows the expand indicator (▼) when the group is expanded', () => {
    renderGroup({ collapsed: false });
    expect(screen.getByText('▼')).toBeTruthy();
  });

  it('sets a click-to-expand title when collapsed', () => {
    const { container } = renderGroup({ collapsed: true, project: 'alpha' });
    const root = container.firstChild as HTMLElement;
    expect(root.title.toLowerCase()).toContain('expand');
    expect(root.title).toContain('alpha');
  });

  it('sets a click-to-collapse title when expanded', () => {
    const { container } = renderGroup({ collapsed: false, project: 'beta' });
    const root = container.firstChild as HTMLElement;
    expect(root.title.toLowerCase()).toContain('collapse');
    expect(root.title).toContain('beta');
  });
});
