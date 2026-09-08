import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/notifications/route.ts'),
  'utf8',
);

describe('notification recipient contact trust boundary', () => {
  it('does not accept caller-provided email, phone, or display name as delivery destinations', () => {
    const postIndex = route.indexOf('export async function POST');
    const deleteIndex = route.indexOf('export async function DELETE');
    const postRoute = route.slice(postIndex, deleteIndex);

    expect(postIndex).toBeGreaterThan(-1);
    expect(postRoute).not.toContain('recipientEmail,');
    expect(postRoute).not.toContain('recipientName,');
    expect(postRoute).not.toContain('const recipientPhone = body.recipientPhone');
    expect(postRoute).not.toContain('to: recipientEmail');
    expect(postRoute).not.toContain('sendNotificationSms(\n        recipientPhone,');
  });

  it('proves active tenant membership before resolving external contacts', () => {
    const postIndex = route.indexOf('export async function POST');
    const membershipIndex = route.indexOf('eq(tenantMemberships.status, \'active\')', postIndex);
    const employeeIndex = route.indexOf('const [recipientEmployee] = await db', postIndex);
    const accountIndex = route.indexOf('const [recipientAccount] = await db', postIndex);

    expect(membershipIndex).toBeGreaterThan(postIndex);
    expect(employeeIndex).toBeGreaterThan(membershipIndex);
    expect(accountIndex).toBeGreaterThan(employeeIndex);
  });

  it('keeps employee contact resolution tenant-scoped and excludes archived staff rows', () => {
    const postIndex = route.indexOf('export async function POST');
    const employeeIndex = route.indexOf('const [recipientEmployee] = await db', postIndex);
    const accountIndex = route.indexOf('const [recipientAccount] = await db', employeeIndex);
    const employeeLookup = route.slice(employeeIndex, accountIndex);

    expect(employeeLookup).toContain('eq(employees.tenantId, tenantId)');
    expect(employeeLookup).toContain('eq(employees.userId, recipientUserId)');
    expect(employeeLookup).toContain('isNull(employees.archivedAt)');
    expect(employeeLookup).toContain('email: employees.email');
    expect(employeeLookup).toContain('phone: employees.phone');
  });

  it('uses employee email first with Better Auth email as an active-member fallback', () => {
    const postIndex = route.indexOf('export async function POST');
    const resolveIndex = route.indexOf('resolvedRecipientEmail =', postIndex);
    const emailSendIndex = route.indexOf('to: resolvedRecipientEmail', resolveIndex);

    expect(resolveIndex).toBeGreaterThan(postIndex);
    expect(route.slice(resolveIndex, emailSendIndex)).toContain(
      "recipientEmployee?.email?.trim() || recipientAccount?.email?.trim() || null",
    );
    expect(emailSendIndex).toBeGreaterThan(resolveIndex);
  });

  it('uses only the authoritative employee phone for SMS delivery', () => {
    const postIndex = route.indexOf('export async function POST');
    const phoneResolveIndex = route.indexOf(
      'resolvedRecipientPhone = recipientEmployee?.phone?.trim() || null',
      postIndex,
    );
    const smsSendIndex = route.indexOf(
      'sendNotificationSms(\n        resolvedRecipientPhone,',
      phoneResolveIndex,
    );

    expect(phoneResolveIndex).toBeGreaterThan(postIndex);
    expect(smsSendIndex).toBeGreaterThan(phoneResolveIndex);
  });
});
