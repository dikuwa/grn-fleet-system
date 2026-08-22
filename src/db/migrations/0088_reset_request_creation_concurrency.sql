-- Close concurrent reset-request creation races without hiding or deleting history.
-- Approved requests are intentionally excluded from this index because approvals
-- expire while remaining reviewable/renewable; the application continues to
-- treat a fresh, unexpired approval as blocking.
CREATE UNIQUE INDEX "tenant_reset_requests_creation_slot_uidx"
ON "tenant_reset_requests" ("tenant_id")
WHERE "status" IN ('draft', 'pending_review', 'in_progress');
