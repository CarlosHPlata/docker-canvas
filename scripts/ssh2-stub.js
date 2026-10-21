// ssh2-stub.js
// Bundled in place of the real ssh2 module.
//
// This extension only connects to Docker via a Unix socket or a Windows named
// pipe (resolved in src/dockerResolver.ts). The SSH transport in docker-modem
// is never reached at runtime, but the require() in modem.js is unconditional,
// so a missing module causes a hard activation failure.
//
// The stub exports a Client class that throws immediately if anything ever
// tries to construct an SSH connection.  A silent fake would hide a real bug
// if SSH support is added later; this surfaces the gap loudly instead.
'use strict';

const { EventEmitter } = require('events');

class Client extends EventEmitter {
  connect() {
    throw new Error(
      'Docker Canvas: SSH Docker transport is not supported. ' +
        'This extension only uses Unix sockets and Windows named pipes. ' +
        'If you see this error, a Docker host configured with ssh:// ' +
        'triggered a code path that has not been implemented.'
    );
  }
}

module.exports = { Client };
