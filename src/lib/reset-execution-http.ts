export type ResetExecutionHttpStatus = 403 | 404 | 409 | 500;

/**
 * Map governed-reset business/precondition failures to controlled HTTP statuses.
 * Unexpected infrastructure or programming failures intentionally remain 500s.
 */
export function resetExecutionHttpStatus(error: unknown): ResetExecutionHttpStatus {
  const message = error instanceof Error ? error.message : String(error);

  if (/^Reset request not found\.?$/i.test(message)) return 404;

  if (
    /Platform-executed|requires Platform execution|handed back to the authorised Tenant Administrator/i.test(
      message,
    )
  ) {
    return 403;
  }

  if (
    /approve|expired|dry run|recovery point|confirmation|changed after execution validation|changed after the dry run|operational reset|not ready to execute|execution claim|backup checksum|backup archive|backup tenant|tenant identity/i.test(
      message,
    )
  ) {
    return 409;
  }

  return 500;
}
