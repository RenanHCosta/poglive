import { app } from 'electron';
import type { WebContents } from 'electron';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { IPC } from '../../shared/contracts';

export class ProcessAudioService {
  private child: ChildProcessWithoutNullStreams | null = null;

  start(
    windowHandle: string | null,
    excludeDiscord: boolean,
    contents: WebContents,
  ): void {
    this.stop();
    const executable = app.isPackaged
      ? resolve(process.resourcesPath, 'voice-share-process-audio.exe')
      : resolve(
          app.getAppPath(),
          'native/process-audio/build/bin/voice-share-process-audio.exe',
        );
    const child = spawn(
      executable,
      excludeDiscord ? ['--exclude-discord'] : [windowHandle!],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.child = child;
    let errorCode = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.child === child && !contents.isDestroyed())
        contents.send(IPC.processAudioData, new Uint8Array(chunk));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      errorCode = `${errorCode}${chunk}`.slice(-200);
    });
    child.once('error', () => {
      if (this.child === child) {
        this.child = null;
        if (!contents.isDestroyed())
          contents.send(IPC.processAudioEnded, 'HELPER_FAILED');
      }
    });
    child.once('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (!contents.isDestroyed())
        contents.send(
          IPC.processAudioEnded,
          code === 0 ? 'WINDOW_ENDED' : errorCode.trim() || 'CAPTURE_FAILED',
        );
    });
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    child?.kill();
  }
}
