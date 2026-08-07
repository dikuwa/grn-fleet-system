-- WS10: Offline incident photo deduplication
--
-- Adds a server-side SHA-256 index for incident attachments so identical
-- photo bytes are uploaded to storage only once per tenant. The upload key
-- embeds the sha256 hash as a prefix (see src/lib/storage buildDedupKey), so
-- duplicate detection is a cheap prefix list without a DB scan; this column
-- records the hash per stored key for audit and DB-side lookups.

ALTER TABLE trip_incidents
  ADD COLUMN IF NOT EXISTS attachment_hashes jsonb DEFAULT '{}'::jsonb;

-- GIN index for containment lookups against attachment_hashes (key -> sha256)
CREATE INDEX IF NOT EXISTS idx_trip_incidents_attachment_hashes
  ON trip_incidents USING GIN (attachment_hashes);
