# QA Credential Rotation Runbook

Use this only for the seeded GRN FLEET QA accounts. The rotation script is allowlisted to the known QA identities and defaults to a dry run.

## 1. Dry run

```bash
pnpm tsx src/scripts/rotate-qa-credentials.ts
```

Confirm the expected QA user and email/password account counts before proceeding.

## 2. Rotate

Set a strong replacement password in the shell without committing it to any file, then execute:

```bash
QA_ROTATION_PASSWORD='<strong-password-at-least-16-chars>' \
  pnpm tsx src/scripts/rotate-qa-credentials.ts --execute
```

The script refuses the retired `changeme` credential, refuses passwords shorter than 16 characters, refuses partial QA account matches, updates only the allowlisted email/password accounts, and never prints the replacement password.

## 3. Verify

Sign in with at least the requester, driver, transport admin, and platform admin QA accounts using the new shared QA password. Keep the password outside the repository and rotate it again if it is exposed.
