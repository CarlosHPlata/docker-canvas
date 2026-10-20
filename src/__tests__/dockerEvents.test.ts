import { describe, it, expect } from 'vitest';
import { parseEventChunk, isWatchedAction } from '../dockerEvents';

const ID = '193e91d92bc68fcbdc1f0aeb5ece44a36d8fd6739aa46640188045cb568db52e';

describe('parseEventChunk', () => {
  it('reads the container ID from Actor.ID on modern Docker (API 1.52, no top-level id)', () => {
    // Verbatim payload from Docker Engine 29.1.3 / API 1.52.
    // Note the complete absence of a top-level `id` or `status` field — reading
    // `event.id` here yields undefined and every inspect() 404s.
    const chunk = JSON.stringify({
      Type: 'container',
      Action: 'die',
      Actor: {
        ID: ID,
        Attributes: { image: 'redis:latest', name: 'canvas-demo-running', exitCode: '0' },
      },
      scope: 'local',
      time: 1792526939,
      timeNano: 1792526939506740932,
    });

    expect(parseEventChunk(chunk)).toEqual([{ action: 'die', id: ID }]);
  });

  it('falls back to the legacy top-level id and status on older daemons', () => {
    const chunk = JSON.stringify({
      status: 'start',
      id: ID,
      from: 'redis:latest',
      Type: 'container',
    });

    expect(parseEventChunk(chunk)).toEqual([{ action: 'start', id: ID }]);
  });

  it('prefers Actor.ID when both forms are present', () => {
    const chunk = JSON.stringify({
      Action: 'stop',
      status: 'stop',
      id: 'legacy-id',
      Actor: { ID: ID },
    });

    expect(parseEventChunk(chunk)).toEqual([{ action: 'stop', id: ID }]);
  });

  it('returns every event when one chunk carries several (a Compose stack starting)', () => {
    const chunk =
      [
        JSON.stringify({ Action: 'create', Actor: { ID: 'a'.repeat(64) } }),
        JSON.stringify({ Action: 'start', Actor: { ID: 'b'.repeat(64) } }),
        JSON.stringify({ Action: 'start', Actor: { ID: 'c'.repeat(64) } }),
      ].join('\n') + '\n';

    expect(parseEventChunk(chunk)).toEqual([
      { action: 'create', id: 'a'.repeat(64) },
      { action: 'start', id: 'b'.repeat(64) },
      { action: 'start', id: 'c'.repeat(64) },
    ]);
  });

  it('keeps the valid events in a chunk that ends with a partial JSON fragment', () => {
    const chunk =
      JSON.stringify({ Action: 'start', Actor: { ID: ID } }) + '\n{"Action":"die","Act';

    expect(parseEventChunk(chunk)).toEqual([{ action: 'start', id: ID }]);
  });

  it('ignores blank lines and whitespace-only chunks', () => {
    expect(parseEventChunk('\n\n  \n')).toEqual([]);
    expect(parseEventChunk('')).toEqual([]);
  });

  it('skips events that carry no resolvable container ID', () => {
    const chunk = JSON.stringify({ Action: 'start', Actor: { Attributes: {} } });
    expect(parseEventChunk(chunk)).toEqual([]);
  });

  it('skips events that carry no action', () => {
    const chunk = JSON.stringify({ Actor: { ID: ID } });
    expect(parseEventChunk(chunk)).toEqual([]);
  });

  it('preserves the full health_status action string', () => {
    const chunk = JSON.stringify({
      Action: 'health_status: unhealthy',
      Actor: { ID: ID },
    });
    expect(parseEventChunk(chunk)).toEqual([
      { action: 'health_status: unhealthy', id: ID },
    ]);
  });
});

describe('isWatchedAction', () => {
  it.each(['create', 'start', 'stop', 'die', 'pause', 'unpause', 'rename', 'destroy'])(
    'watches %s',
    (action) => {
      expect(isWatchedAction(action)).toBe(true);
    },
  );

  it('watches health_status events regardless of the reported status', () => {
    expect(isWatchedAction('health_status: healthy')).toBe(true);
    expect(isWatchedAction('health_status: unhealthy')).toBe(true);
  });

  it.each(['attach', 'exec_create', 'exec_start', 'top', 'resize', 'commit'])(
    'ignores %s, which does not change what the canvas shows',
    (action) => {
      expect(isWatchedAction(action)).toBe(false);
    },
  );
});
