import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core';

/**
 * Better Auth user extension table
 * Stores the Better Auth user ID and additional local user fields
 */
export const userProfiles = pgTable('user_profiles', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().unique(), // Better Auth user ID
  displayName: text('display_name'),
  requiresPasswordChange: boolean('requires_password_change').notNull().default(true),
  status: text('status').notNull().default('active'), // active, suspended
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Note: Better Auth manages its own user, session, account, and verification tables.
 * This schema extends Better Auth with project-specific fields.
 *
 * The core Better Auth user table is expected to have:
 * - id (text, primary key)
 * - email (text, unique)
 * - emailVerified (boolean)
 * - name (text, nullable)
 * - image (text, nullable)
 * - createdAt (timestamp)
 * - updatedAt (timestamp)
 *
 * Password hashing, session management, and email verification are handled by Better Auth.
 */

export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
