# Production blocker closure E2E coverage

This note tracks the targeted regression coverage added during the final GRN FLEET production-closure pass. It is intentionally narrow: already-closed audit areas are not reopened unless a regression is reproduced.

Current closure coverage includes:

- deterministic Tenant B isolation fixture for Playwright runs;
- all 13 seeded roles exercising the real Light/Dark selector, Notifications route, and allowed/denied Documents workspace boundary;
- driver licence upload/review lifecycle with a remote-safe finite OCR/storage timeout;
- Chromium native print-media verification that dashboard chrome/toasts are excluded and an A4 PDF is printable;
- Supervisor Return -> requester resubmit with old approval notifications resolved and a fresh workflow created;
- requester cancellation with pending approval notifications resolved rather than left stale.

The remaining stateful lifecycle scenarios (revised Trip Authority, external driver, and a clean return/closure that restores vehicle availability) should remain separate tests so a failure identifies the responsible lifecycle boundary instead of being hidden inside a monolithic smoke test.
