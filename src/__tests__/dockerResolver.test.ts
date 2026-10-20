import { describe, it, expect } from 'vitest';
import { parseDockerHost } from '../dockerResolver';

describe('parseDockerHost', () => {
  // unix:// — returns the path portion as socketPath
  it('unix:// with absolute path', () => {
    expect(parseDockerHost('unix:///var/run/docker.sock')).toEqual({
      socketPath: '/var/run/docker.sock',
    });
  });

  it('unix:// with non-standard path', () => {
    expect(parseDockerHost('unix:///run/user/1000/docker.sock')).toEqual({
      socketPath: '/run/user/1000/docker.sock',
    });
  });

  // npipe:// — normalises both the two-slash and four-slash Docker Desktop forms
  it('npipe:// four-slash variant (Docker Desktop canonical form)', () => {
    // npipe:////./pipe/docker_engine — after npipe:// the remainder is //./pipe/...
    expect(parseDockerHost('npipe:////./pipe/docker_engine')).toEqual({
      socketPath: '//./pipe/docker_engine',
    });
  });

  it('npipe:// four-slash variant with dockerDesktopLinuxEngine', () => {
    expect(parseDockerHost('npipe:////./pipe/dockerDesktopLinuxEngine')).toEqual({
      socketPath: '//./pipe/dockerDesktopLinuxEngine',
    });
  });

  it('npipe:// two-slash variant (one extra slash after npipe://)', () => {
    // npipe:///./pipe/docker_engine — after npipe:// the remainder is /./pipe/...
    expect(parseDockerHost('npipe:///./pipe/docker_engine')).toEqual({
      socketPath: '//./pipe/docker_engine',
    });
  });

  // tcp:// — maps to http protocol
  it('tcp://host:port → http protocol', () => {
    expect(parseDockerHost('tcp://localhost:2375')).toEqual({
      protocol: 'http',
      host: 'localhost',
      port: 2375,
    });
  });

  it('tcp:// with IP address', () => {
    expect(parseDockerHost('tcp://192.168.1.1:2375')).toEqual({
      protocol: 'http',
      host: '192.168.1.1',
      port: 2375,
    });
  });

  // http:// — also maps to http protocol
  it('http://host:port → http protocol', () => {
    expect(parseDockerHost('http://0.0.0.0:2375')).toEqual({
      protocol: 'http',
      host: '0.0.0.0',
      port: 2375,
    });
  });

  // https:// — maps to https protocol
  it('https://host:port → https protocol', () => {
    expect(parseDockerHost('https://docker.remote.example.com:2376')).toEqual({
      protocol: 'https',
      host: 'docker.remote.example.com',
      port: 2376,
    });
  });

  // Unrecognised / bare values — fallback to raw socketPath
  it('unrecognised scheme → raw value as socketPath', () => {
    expect(parseDockerHost('some-unrecognised-value')).toEqual({
      socketPath: 'some-unrecognised-value',
    });
  });

  it('bare socket path with no scheme → raw value as socketPath', () => {
    expect(parseDockerHost('/var/run/docker.sock')).toEqual({
      socketPath: '/var/run/docker.sock',
    });
  });
});
