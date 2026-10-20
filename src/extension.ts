import * as vscode from 'vscode';
import Docker from 'dockerode';
import { resolveDockerOptions } from './dockerResolver';

let outputChannel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Docker Canvas');
  context.subscriptions.push(outputChannel);

  const cmd = vscode.commands.registerCommand(
    'dockerCanvas.listContainers',
    () => void listContainers(),
  );
  context.subscriptions.push(cmd);

  // Auto-run on activation so the spike immediately shows output.
  void listContainers();
}

export function deactivate(): void {
  // nothing to clean up — the output channel is disposed via subscriptions
}

async function listContainers(): Promise<void> {
  const channel = outputChannel!;
  channel.show(/* preserveFocus */ true);
  channel.appendLine('');
  channel.appendLine('── Docker Canvas ─────────────────────────────────────────');
  channel.appendLine(`  Timestamp : ${new Date().toISOString()}`);

  let opts: Awaited<ReturnType<typeof resolveDockerOptions>>;
  try {
    opts = await resolveDockerOptions();
  } catch (err) {
    channel.appendLine(`  ERROR     : failed to resolve Docker connection — ${String(err)}`);
    return;
  }

  const connDesc = opts.socketPath
    ? `socket  ${opts.socketPath}`
    : `tcp     ${opts.host ?? ''}:${opts.port ?? ''}`;
  channel.appendLine(`  Transport : ${connDesc}`);

  const docker = new Docker(opts);

  try {
    const containers = await docker.listContainers({ all: true });
    channel.appendLine(`  Found     : ${containers.length} container(s)`);
    channel.appendLine('');
    channel.appendLine(
      '  STATE      NAME                           IMAGE                                    STATUS',
    );
    channel.appendLine(
      '  ─────────  ─────────────────────────────  ─────────────────────────────────────────  ─────────────────────────',
    );

    if (containers.length === 0) {
      channel.appendLine('  (no containers found)');
    } else {
      for (const c of containers) {
        const name = (c.Names[0] ?? '').replace(/^\//, '');
        channel.appendLine(
          `  ${c.State.padEnd(9)}  ${name.padEnd(29)}  ${c.Image.padEnd(39)}  ${c.Status}`,
        );
      }
    }
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;

    if (
      error.code === 'EACCES' &&
      opts.socketPath != null &&
      !opts.socketPath.includes('pipe')
    ) {
      // Linux socket permission error — give the user an actionable hint
      const hint =
        `Permission denied on ${opts.socketPath}.\n` +
        `Your user is not in the "docker" group.\n` +
        `Run:  sudo usermod -aG docker $USER\n` +
        `Then log out and back in (or run: newgrp docker).`;

      channel.appendLine('');
      channel.appendLine('  ERROR     : EACCES — ' + hint.replace(/\n/g, '\n              '));

      void vscode.window.showErrorMessage(
        `Docker Canvas: permission denied on ${opts.socketPath}. ` +
          `Add your user to the "docker" group: sudo usermod -aG docker $USER`,
      );
      return;
    }

    const message = error.message ?? String(err);
    channel.appendLine(`  ERROR     : ${message}`);
    void vscode.window.showErrorMessage(`Docker Canvas: ${message}`);
  }
}
