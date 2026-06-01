import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ShareSnapshotSchema,
  StoredShareSchema,
  type ShareSnapshot,
  type StoredShare
} from './shareSchemas.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SHARE_ROOT = path.resolve(__dirname, '../../.local/shared-projects');
const SHARE_ID_PATTERN = /^[a-f0-9]{32}$/;

export type ShareStore = {
  create(snapshot: ShareSnapshot): Promise<StoredShare>;
  read(shareId: string): Promise<StoredShare | null>;
};

export function createFileShareStore(rootDir = DEFAULT_SHARE_ROOT): ShareStore {
  const resolvedRoot = path.resolve(rootDir);

  return {
    async create(snapshot: ShareSnapshot): Promise<StoredShare> {
      const shareId = createShareId();
      const parsedSnapshot = ShareSnapshotSchema.parse({
        ...snapshot,
        id: shareId
      });
      const stored = StoredShareSchema.parse({
        shareId,
        createdAt: parsedSnapshot.createdAt,
        snapshot: parsedSnapshot
      });

      await mkdir(resolvedRoot, { recursive: true });
      await writeFile(sharePath(resolvedRoot, shareId), JSON.stringify(stored, null, 2), 'utf8');
      return stored;
    },

    async read(shareId: string): Promise<StoredShare | null> {
      assertValidShareId(shareId);
      try {
        const content = await readFile(sharePath(resolvedRoot, shareId), 'utf8');
        return StoredShareSchema.parse(JSON.parse(content));
      } catch (error) {
        if (isFileNotFound(error)) {
          return null;
        }
        throw error;
      }
    }
  };
}

export function assertValidShareId(shareId: string) {
  if (!SHARE_ID_PATTERN.test(shareId)) {
    throw new Error('Invalid share id.');
  }
}

function createShareId() {
  return randomBytes(16).toString('hex');
}

function sharePath(rootDir: string, shareId: string) {
  assertValidShareId(shareId);
  const filePath = path.resolve(rootDir, `${shareId}.json`);
  if (!filePath.startsWith(rootDir + path.sep)) {
    throw new Error('Invalid share id.');
  }
  return filePath;
}

function isFileNotFound(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
