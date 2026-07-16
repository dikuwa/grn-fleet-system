/**
 * Admin User Seed
 *
 * Creates a Better Auth admin login account with tenant membership.
 * This is separate from the main seed to avoid conflicts on re-run.
 *
 * Run: npx tsx src/seed/seed-users.ts
 */
import { getDb } from '@/db';
import {
  tenantMemberships,
  user,
  account,
} from '@/db/schema';
import { tenants } from '@/db/schema/tenants';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function seedUsers() {
  const db = getDb();
  console.log('👤 Seeding admin login account...');

  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  // Verify tenant exists
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, TENANT_ID as any))
    .limit(1);

  if (!tenant) {
    console.error('❌ Tenant not found. Run the main seed first.');
    process.exit(1);
  }

  // Hash password
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  // Create Better Auth user
  const userId = `user-admin-${uuid().slice(0, 8)}`;
  await db.insert(user).values({
    id: userId,
    email: adminEmail,
    emailVerified: true,
    name: 'Kandjimi Amupanda',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing({ target: user.email });

  // Get the inserted/colliding user
  const [userRecord] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, adminEmail))
    .limit(1);

  if (!userRecord) {
    console.error('❌ Failed to create user.');
    process.exit(1);
  }

  // Check if account already exists for this user
  const [existingAccount] = await db
    .select({ id: account.id })
    .from(account)
    .where(eq(account.userId, userRecord.id))
    .limit(1);

  if (!existingAccount) {
    await db.insert(account).values({
      id: `acc-admin-${uuid().slice(0, 8)}`,
      accountId: adminEmail,
      providerId: 'email',
      userId: userRecord.id,
      password: passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } else {
    // Update password on re-run
    await db.update(account)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(eq(account.id, existingAccount.id));
    console.log('   Account already exists, password updated.');
  }

  // Create tenant membership (check first)
  await db.insert(tenantMemberships).values({
    tenantId: TENANT_ID as any,
    userId: userRecord.id,
    status: 'active',
  }).onConflictDoNothing();

  console.log('✅ Admin user created!');
  console.log(`   Email:    ${adminEmail}`);
  console.log(`   Password: ${adminPassword}`);
  console.log(`   User ID:  ${userRecord.id}`);
}

seedUsers()
  .catch((e: unknown) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .then(() => process.exit(0));
