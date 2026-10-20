import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ContainerInfo } from '../src/protocol';

/** Generic shipping-container glyph. Stroke colour shifts by state. */
function ContainerGlyph({ running, restarting }: { running: boolean; restarting: boolean }) {
  const stroke = restarting ? '#e5c07b' : running ? '#4ec9b0' : 'currentColor';
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
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
  const isRestarting = c.state === 'restarting';
  const health = c.health ?? 'none';

  const borderColor = isRestarting
    ? '#e5c07b'
    : isRunning
    ? '#4ec9b0'
    : 'var(--vscode-editorGroup-border, #555)';

  const shouldDim = !isRunning && !isRestarting;

  const stateColor = isRestarting
    ? '#e5c07b'
    : isRunning
    ? '#4ec9b0'
    : 'var(--vscode-descriptionForeground, #858585)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderRadius: 6,
        border: `1.5px solid ${borderColor}`,
        background: 'var(--vscode-editor-background, #1e1e1e)',
        color: 'var(--vscode-editor-foreground, #d4d4d4)',
        minWidth: 200,
        maxWidth: 240,
        boxSizing: 'border-box',
        filter: shouldDim ? 'grayscale(1)' : 'none',
        opacity: shouldDim ? 0.55 : 1,
        userSelect: 'none',
      }}
    >
      {/* Handles are invisible — edges are not used in this release */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} />

      <ContainerGlyph running={isRunning} restarting={isRestarting} />

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
          <span style={{ fontSize: 10, color: stateColor }}>{c.state}</span>
          {health === 'unhealthy' && (
            <span
              style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 10,
                background: '#f44747',
                color: '#fff',
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              unhealthy
            </span>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />
    </div>
  );
}

export default memo(ContainerNode);
