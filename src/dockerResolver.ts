/**
 * dockerResolver.ts
 *
 * Resolves how to connect to the local Docker Engine.
 *
 * Resolution order:
 *   1. DOCKER_HOST environment variable
 *   2. Active Docker context (~/.docker/config.json → contexts/meta/<hash>/meta.json)
 *   3. Platform default socket
 *      - Linux/macOS: /var/run/docker.sock
 *      - Windows:     //./pipe/docker_engine
 *
 * Kept in its own module so Phase 2 reconnect logic and Phase 4 empty-state
 * handling can import it independently.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type Dockerode from 'dockerode';

/** The subset of DockerOptions we populate during resolution. */
export type DockerConnectionOptions = Pick<
  Dockerode.DockerOptions,
  'socketPath' | 'host' | 'port' | 'protocol'
>;

/**
 * Resolves Docker connection options by inspecting the environment and
 * the user's Docker context configuration.
 */
export async function resolveDockerOptions(): Promise<DockerConnectionOptions> {
  const dockerHost = process.env['DOCKER_HOST'];
  if (dockerHost) {
    return parseDockerHost(dockerHost);
  }

  const contextOpts = await resolveFromDockerContext();
  if (contextOpts !== undefined) {
    return contextOpts;
  }

  return { socketPath: platformDefaultSocket() };
}

/** The default socket path for the current platform. */
function platformDefaultSocket(): string {
  return process.platform === 'win32'
    ? '//./pipe/docker_engine'
    : '/var/run/docker.sock';
}

/**
 * Parses a DOCKER_HOST value into DockerConnectionOptions.
 *
 * Supported forms:
 *   unix:///var/run/docker.sock
 *   npipe:////./pipe/docker_engine
 *   tcp://host:port
 *   http://host:port
 *   https://host:port
 */
export function parseDockerHost(dockerHost: string): DockerConnectionOptions {
  // Unix socket
  const unixMatch = /^unix:\/\/(.+)/.exec(dockerHost);
  if (unixMatch) {
    return { socketPath: unixMatch[1] };
  }

  // Windows named pipe. Docker writes the four-slash form
  // (npipe:////./pipe/docker_engine); the two-slash form is also seen in the
  // wild. Normalise both to the //./pipe/<name> path dockerode expects.
  const npipeMatch = /^npipe:\/\/(.+)/.exec(dockerHost);
  if (npipeMatch) {
    const pipePath = (npipeMatch[1] as string).replace(/^\/+/, '');
    return { socketPath: `//${pipePath}` };
  }

  // TCP / HTTP / HTTPS
  const tcpMatch = /^(tcp|http|https):\/\/([^:/]+):(\d+)/.exec(dockerHost);
  if (tcpMatch) {
    const rawProto = tcpMatch[1] as string;
    const protocol: 'http' | 'https' = rawProto === 'https' ? 'https' : 'http';
    return {
      protocol,
      host: tcpMatch[2],
      port: parseInt(tcpMatch[3], 10),
    };
  }

  // Fallback: treat the raw value as a socket path
  return { socketPath: dockerHost };
}

/**
 * Reads ~/.docker/config.json, finds the currentContext, then walks
 * ~/.docker/contexts/meta/<hash>/meta.json to locate the endpoint Host.
 *
 * Returns DockerConnectionOptions if a non-default context with a recognisable
 * endpoint is found, undefined otherwise.
 */
async function resolveFromDockerContext(): Promise<DockerConnectionOptions | undefined> {
  try {
    const configDir = process.env['DOCKER_CONFIG'] ?? path.join(os.homedir(), '.docker');
    const configPath = path.join(configDir, 'config.json');
    const configRaw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configRaw) as { currentContext?: string };

    const context = config.currentContext;
    if (!context || context === 'default') {
      return undefined;
    }

    // Context metadata lives under ~/.docker/contexts/meta/<sha256>/meta.json
    const metaRoot = path.join(configDir, 'contexts', 'meta');
    const hashes = fs.readdirSync(metaRoot);

    for (const hash of hashes) {
      const metaPath = path.join(metaRoot, hash, 'meta.json');
      try {
        const metaRaw = fs.readFileSync(metaPath, 'utf8');
        const meta = JSON.parse(metaRaw) as {
          Name?: string;
          Endpoints?: { docker?: { Host?: string } };
        };

        if (meta.Name !== context) {
          continue;
        }

        const host = meta.Endpoints?.docker?.Host;
        if (!host) {
          return undefined;
        }

        // Parse the context endpoint the same way as DOCKER_HOST
        return parseDockerHost(host);
      } catch {
        // Corrupted or unreadable meta file — skip and keep looking
      }
    }
  } catch {
    // No config file, no contexts directory, or JSON parse error — not an error
  }

  return undefined;
}
