import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { account, session, user } from '@/db/schema';

const QA_EMAILS = [
  'admin@kavangoeast.gov.na',
  'platform.admin@grnfleet.test',
  'transport.admin@kavangoeast.test',
  'requester@kavangoeast.test',
  'supervisor@kavangoeast.test',
  'release.officer@kavangoeast.test',
  'regional.authoriser@kavangoeast.test',
  'national.release@kavangoeast.test',
  'national.authoriser@kavangoeast.test',
  'driver@kavangoeast.test',
  'inspector@kavangoeast.test',
  'maintenance@kavangoeast.test',
  'auditor@kavangoeast.test',
] as const;

const execute = process.argv.includes('--execute');
const password = process.env.QA_ROTATION_PASSWORD || '';

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function main() {
  if (execute) {
    if (!password) fail('QA_ROTATION_PASSWORD is required with --execute.');
    if (password === 'changeme') fail('Refusing to rotate QA accounts to the retired default password.');
    if (password.length < 16) fail('QA_ROTATION_PASSWORD must be at least 16 characters.');
  }

  const db = getDb();
  const qaUsers = await db
    .select({ id: user.id, email: user.email, username: user.username })
    .from(user)
    .where(inArray(user.email, [...QA_EMAILS]));

  const foundEmails = new Set(qaUsers.map((row) => row.email));
  const missing = QA_EMAILS.filter((email) => !foundEmails.has(email));

  const qaAccounts = qaUsers.length
    ? await db
        .select({ id: account.id, userId: account.userId, providerId: account.providerId })
        .from(account)
        .where(
          and(
            inArray(account.userId, qaUsers.map((row) => row.id)),
            eq(account.providerId, 'email'),
          ),
        )
    : [];

  console.log(`QA users matched: ${qaUsers.length}/${QA_EMAILS.length}`);
  console.log(`Email/password accounts matched: ${qaAccounts.length}`);
  if (missing.length) console.log(`Missing expected QA users: ${missing.join(', ')}`);

  if (!execute) {
    console.log('DRY RUN ONLY — no credentials changed. Re-run with --execute and QA_ROTATION_PASSWORD set.');
    return;
  }

  if (qaUsers.length === 0 || qaAccounts.length === 0) {
    fail('No QA email/password accounts matched; refusing to update anything.');
  }
  if (qaAccounts.length !== qaUsers.length) {
    fail('QA user/account counts differ; refusing a partial credential rotation.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const rotatedAt = new Date();
  const qaUserIds = qaUsers.map((row) => row.id);

  await db.transaction(async (tx) => {
    for (const qaAccount of qaAccounts) {
      await tx
        .update(account)
        .set({ password: passwordHash, updatedAt: rotatedAt })
        .where(and(eq(account.id, qaAccount.id), eq(account.providerId, 'email')));
    }

    await tx.delete(session).where(inArray(session.userId, qaUserIds));
  });

  console.log(`✅ Rotated ${qaAccounts.length} QA email/password accounts and revoked their active sessions.`);
  console.log('Password value was not logged.');
}

main().catch((error: unknown) => {
  console.error('❌ QA credential rotation failed.');
  if (error instanceof Error) console.error(error.message);
  process.exit(1);
});
