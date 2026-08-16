-- Generated-document lifecycle integrity.
--
-- Keep the newest issued version current if historical data contains more than
-- one issued version for the same tenant/entity/document family, then enforce
-- version uniqueness and a single current issued version at the database layer.

WITH ranked_issued AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, entity_type, entity_id, document_type
      ORDER BY document_version DESC, created_at DESC, id DESC
    ) AS issued_rank
  FROM generated_documents
  WHERE status = 'issued'
)
UPDATE generated_documents AS document
SET
  status = 'superseded',
  updated_at = now()
FROM ranked_issued AS ranked
WHERE document.id = ranked.id
  AND ranked.issued_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_generated_documents_entity_version
  ON generated_documents (
    tenant_id,
    entity_type,
    entity_id,
    document_type,
    document_version
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_generated_documents_current_issued
  ON generated_documents (tenant_id, entity_type, entity_id, document_type)
  WHERE status = 'issued';

CREATE INDEX IF NOT EXISTS idx_generated_documents_tenant_entity
  ON generated_documents (tenant_id, entity_type, entity_id, document_type);
