/**
 * Parsing for the Docker Engine `/events` stream.
 *
 * Kept free of `vscode` and `dockerode` imports so it can be unit-tested.
 */

/** A container event reduced to the fields the canvas cares about. */
export interface ParsedDockerEvent {
  /** Normalised event action, e.g. "start", "die", "health_status: healthy". */
  action: string;
  /** Full container ID. */
  id: string;
}

/**
 * Container actions that change what the canvas shows.
 * `health_status: …` is matched by prefix because the status is part of the action.
 */
const WATCHED_ACTIONS = [
  'create',
  'start',
  'stop',
  'die',
  'pause',
  'unpause',
  'rename',
  'destroy',
];

export function isWatchedAction(action: string): boolean {
  return WATCHED_ACTIONS.includes(action) || action.startsWith('health_status');
}

/**
 * Parses one chunk from the events stream into zero or more events.
 *
 * Two things this has to get right:
 *
 * 1. **A chunk is not a message.** The daemon writes newline-delimited JSON and
 *    a single chunk may carry several events (common when Compose starts a
 *    stack) or a partial one. `JSON.parse(chunk)` therefore throws and drops
 *    real events; we split on newlines and skip fragments instead.
 *
 * 2. **The container ID lives in `Actor.ID`.** The legacy top-level `id` /
 *    `status` fields were removed from the events payload in modern Docker
 *    (absent on Engine API 1.52 / Docker 29). Reading `event.id` yields
 *    `undefined`, every subsequent `inspect()` 404s, and the canvas silently
 *    stops updating. `id` is still honoured as a fallback for old daemons.
 */
export function parseEventChunk(chunk: string): ParsedDockerEvent[] {
  const events: ParsedDockerEvent[] = [];

  for (const line of chunk.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let raw: {
      Action?: string;
      status?: string;
      id?: string;
      Actor?: { ID?: string };
    };
    try {
      raw = JSON.parse(trimmed);
    } catch {
      // Partial JSON at a chunk boundary — ignore this fragment.
      continue;
    }

    const action = raw.Action ?? raw.status;
    const id = raw.Actor?.ID ?? raw.id;
    if (!action || !id) continue;

    events.push({ action, id });
  }

  return events;
}
