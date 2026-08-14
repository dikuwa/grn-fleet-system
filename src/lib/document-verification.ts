import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { resolveShortSharedDocument } from '@/lib/share-token';

export type PublicVerificationResult =
  | {
      kind: 'permanent';
      document: typeof generatedDocuments.$inferSelect;
      verificationCode: string;
      verificationSlug: string;
    }
  | {
      kind: 'share';
      document: typeof generatedDocuments.$inferSelect;
      shareLink: NonNullable<Awaited<ReturnType<typeof resolveShortSharedDocument>>['shareLink']>;
    }
  | {
      kind: 'invalid';
      error: string;
    };

/**
 * Resolve the compact /v/:slug route.
 *
 * Permanent generated-document identities are checked first. Temporary share
 * links remain a separate fallback with their existing expiry/revocation/view
 * policies, so official verification never depends on a share link staying alive.
 */
export async function resolvePublicVerification(slug: string): Promise<PublicVerificationResult> {
  const normalised = String(slug || '').trim().toLowerCase();
  if (!normalised) return { kind: 'invalid', error: 'not_found' };

  const db = getDb();
  const [document] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.verificationSlug, normalised))
    .limit(1);

  if (document) {
    return {
      kind: 'permanent',
      document,
      verificationCode: document.verificationCode,
      verificationSlug: document.verificationSlug,
    };
  }

  const shared = await resolveShortSharedDocument(slug);
  if (shared.document && shared.shareLink) {
    return { kind: 'share', document: shared.document, shareLink: shared.shareLink };
  }
  return { kind: 'invalid', error: shared.error || 'not_found' };
}

export function abbreviatedDocumentHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  if (hash.length <= 20) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}
