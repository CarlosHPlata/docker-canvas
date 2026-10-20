import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ContainerInfo } from '../src/protocol';

/** Generic shipping-container glyph. Stroke colour shifts green when running. */
function ContainerGlyph({ running }: { running: boolean }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke={running ? '#4ec9b0' : 'currentColor'}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Container body */}
      <rect x="2" y="8" width="20" height="13" rx="1.5" />
      {/* Corrugation lines */}
      <line x1="7" y1="8" x2="7" y2="21" />
      <line x1="12" y1="8" x2="12" y2="21" />
      <line x1="17" y1="8" x2="17" y2="21" />
      {/* Lid ridge */}
      <polyline points="4,8 12,3 20,8" />
    </svg>
  );
}

function ContainerNode({ data }: NodeProps) {
  const c = data as unknown as ContainerInfo;
  const isRunning = c.state === 'running';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderRadius: 6,
        border: `1.5px solid ${isRunning ? '#4ec9b0' : 'var(--vscode-editorGroup-border, #555)'}`,
        background: 'var(--vscode-editor-background, #1e1e1e)',
        color: 'var(--vscode-editor-foreground, #d4d4d4)',
        minWidth: 200,
        maxWidth: 240,
        boxSizing: 'border-box',
        filter: isRunning ? 'none' : 'grayscale(1)',
        opacity: isRunning ? 1 : 0.55,
        userSelect: 'none',
      }}
    >
      {/* Handles are invisible — edges are not used in this release */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} />

      <ContainerGlyph running={isRunning} />

      <div style={{ overflow: 'hidden', flex: 1 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 13,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={c.name}
        >
          {c.name}
        </div>
        <div
          style={{
            fontSize: 11,
            opacity: 0.65,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginTop: 2,
          }}
          title={c.image}
        >
          {c.image}
        </div>
        <div
          style={{
            fontSize: 10,
            marginTop: 3,
            color: isRunning
              ? '#4ec9b0'
              : 'var(--vscode-descriptionForeground, #858585)',
          }}
        >
          {c.state}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />
    </div>
  );
}

export default memo(ContainerNode);
