import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb, isDbConnected } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { getServerSession } from '@/lib/session';
import { canSessionReadGeneratedDocument } from '@/lib/document-access';

interface DocumentDetailLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

/**
 * Record-level authorization boundary for every dashboard document-detail view.
 *
 * Tenant isolation alone is not enough for personal/requester and assigned-role
 * workspaces. Keep the page boundary aligned with the canonical PDF endpoint so
 * a same-tenant user cannot discover document metadata, share links or lifecycle
 * controls by guessing another generated document ID.
 */
export default async function DocumentDetailLayout({
  children,
  params,
}: DocumentDetailLayoutProps) {
  // Let the child page render its existing database-configuration empty state.
  if (!isDbConnected()) return children;

  const session = await getServerSession();
  if (!session) notFound();

  const { id } = await params;
  const db = getDb();
  const [document] = await db
    .select()
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.id, id),
        eq(generatedDocuments.tenantId, session.tenantId),
      ),
    )
    .limit(1);

  if (!document) notFound();

  const canRead = await canSessionReadGeneratedDocument(session, document);
  if (!canRead) notFound();

  return children;
}
