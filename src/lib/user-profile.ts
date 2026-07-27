'use client';

export interface UserProfileData {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
  profile: {
    displayName: string | null;
    requiresPasswordChange: boolean;
    status: string;
    lastLoginAt: string | null;
  } | null;
  employee: {
    firstName: string;
    lastName: string;
    employeeNumber: string;
    jobTitle: string | null;
    departmentId: string | null;
    officeId: string | null;
  } | null;
  roles: Array<{ roleName: string; isActing: boolean }>;
  tenantId: string;
  tenantSlug: string;
}

export const userProfileQueryKey = ['user-profile'] as const;

export async function fetchUserProfile(signal?: AbortSignal): Promise<UserProfileData> {
  const response = await fetch('/api/users/profile', {
    signal,
    cache: 'no-store',
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || 'Failed to load profile');
  }
  return json.data as UserProfileData;
}
