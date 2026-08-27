import { beforeEach, describe, expect, it, vi } from 'vitest';

const deleteFile = vi.fn();
const isStorageConfigured = vi.fn();

vi.mock('@/lib/storage', () => ({
  deleteFile,
  isStorageConfigured,
}));
vi.mock('@/db', () => ({
  getDb: () => ({ execute: vi.fn() }),
}));

import { deleteResetStorageKeys } from './storage-cleanup';

describe('reset storage cleanup', () => {
  beforeEach(() => {
    deleteFile.mockReset();
    isStorageConfigured.mockReset();
  });

  it('does not claim deletion when durable storage is not configured', async () => {
    isStorageConfigured.mockReturnValue(false);

    await expect(deleteResetStorageKeys(['tenant/a.pdf', 'tenant/a.pdf'])).resolves.toEqual({
      configured: false,
      planned: 1,
      removed: 0,
      failed: [],
      preserved: 1,
    });
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('deduplicates keys and reports individual cleanup failures', async () => {
    isStorageConfigured.mockReturnValue(true);
    deleteFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('R2 unavailable'));

    await expect(
      deleteResetStorageKeys(['tenant/a.pdf', 'tenant/a.pdf', 'tenant/b.pdf']),
    ).resolves.toEqual({
      configured: true,
      planned: 2,
      removed: 1,
      failed: [{ key: 'tenant/b.pdf', error: 'R2 unavailable' }],
      preserved: 1,
    });
    expect(deleteFile).toHaveBeenCalledTimes(2);
  });
});
