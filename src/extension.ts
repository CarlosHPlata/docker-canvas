import * as vscode from 'vscode';
import Docker from 'dockerode';
import { resolveDockerOptions } from './dockerResolver';
import { CanvasPanel } from './panel';

let outputChannel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Docker Canvas');
  context.subscriptions.push(outputChannel);

  const openCmd = vscode.commands.registerCommand(
    'dockerCanvas.openCanvas',
    () => void CanvasPanel.createOrShow(context.extensionUri, context.workspaceState),
  );
  context.subscriptions.push(openCmd);

  const listCmd = vscode.commands.registerCommand(
    'dockerCanvas.listContainers',
    () => void listContainers(),
  );
  context.subscriptions.push(listCmd);

  const resetLayoutCmd = vscode.commands.registerCommand(
    'dockerCanvas.resetLayout',
    () => {
      if (CanvasPanel.currentPanel) {
        void CanvasPanel.currentPanel.resetLayout();
      } else {
        void vscode.window.showInformationMessage(
          'Docker Canvas: open the canvas first to reset the layout.',
        );
      }
    },
  );
  context.subscriptions.push(resetLayoutCmd);

  // Container lifecycle actions — invoked by the webview/context menu.
  // The context object from data-vscode-context is passed as the first argument.
  interface ContainerContext {
    containerId?: string;
  }

  const startCmd = vscode.commands.registerCommand(
    'dockerCanvas.startContainer',
    (ctx: ContainerContext | undefined) => {
      if (ctx?.containerId) {
        void CanvasPanel.currentPanel?.performAction('start', ctx.containerId);
      }
    },
  );
  context.subscriptions.push(startCmd);

  const stopCmd = vscode.commands.registerCommand(
    'dockerCanvas.stopContainer',
    (ctx: ContainerContext | undefined) => {
      if (ctx?.containerId) {
        void CanvasPanel.currentPanel?.performAction('stop', ctx.containerId);
      }
    },
  );
  context.subscriptions.push(stopCmd);

  const restartCmd = vscode.commands.registerCommand(
    'dockerCanvas.restartContainer',
    (ctx: ContainerContext | undefined) => {
      if (ctx?.containerId) {
        void CanvasPanel.currentPanel?.performAction('restart', ctx.containerId);
      }
    },
  );
  context.subscriptions.push(restartCmd);

  // Auto-run on activation so the diagnostic output channel has data immediately.
  void listContainers();
}

export function deactivate(): void {
  // Subscriptions are disposed automatically via context.subscriptions.
}

async function listContainers(): Promise<void> {
  const channel = outputChannel!;
  channel.show(/* preserveFocus */ true);
  channel.appendLine('');
  channel.appendLine('── Docker Canvas ───────────────────────────────────────────');
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
      '  ─────────  ─────────────────────────────  ───────────────────────────────────────  ──────────────────────────',
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
