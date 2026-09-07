import { mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { identitySchema, displayNameSchema } from '../../shared/schemas/room';
import type { Identity } from '../../shared/schemas/room';

export class IdentityStore {
  private identity: Identity | null = null;
  constructor(private readonly directory: string) {}
  get(): Identity | null {
    return this.identity;
  }
  async load(): Promise<void> {
    const path = join(this.directory, 'identity.json');
    try {
      if ((await stat(path)).size > 4096) throw new Error('Identity size');
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      this.identity = identitySchema.parse(parsed);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return;
      throw new Error(
        'Não foi possível ler a identidade local. O arquivo foi preservado.',
        { cause: error },
      );
    }
  }
  async save(displayName: string): Promise<void> {
    const identity = {
      peerId: this.identity?.peerId ?? randomUUID(),
      displayName: displayNameSchema.parse(displayName),
    };
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, 'identity.json');
    await writeFile(`${path}.tmp`, JSON.stringify(identity), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    this.identity = identity;
  }
}
