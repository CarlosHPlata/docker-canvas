import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';

export interface ComposeGroupNodeData extends Record<string, unknown> {
  project: string;
  count: number;
  collapsed: boolean;
}

/**
 * Header node that frames a docker-compose project group on the canvas.
 * Clicking the node toggles the group's collapsed state (handled via
 * onNodeClick in App.tsx).
 */
function ComposeGroupNode({ data }: NodeProps) {
  const { project, count, collapsed } = data as ComposeGroupNodeData;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 10px',
        borderRadius: 4,
        background: 'var(--vscode-editorGroupHeader-tabsBackground, #252526)',
        border: '1px solid var(--vscode-editorGroup-border, #3c3c3c)',
        color: 'var(--vscode-editor-foreground, #d4d4d4)',
        fontSize: 12,
        cursor: 'pointer',
        userSelect: 'none',
        minWidth: 200,
      }}
      title={collapsed ? `Click to expand ${project}` : `Click to collapse ${project}`}
    >
      <span style={{ fontSize: 9, opacity: 0.7, flexShrink: 0 }}>
        {collapsed ? '▶' : '▼'}
      </span>
      <span
        style={{
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1,
        }}
      >
        {project}
      </span>
      <span
        style={{
          opacity: 0.55,
          fontSize: 11,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {count} container{count !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

export default memo(ComposeGroupNode);
