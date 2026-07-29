'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  User,
  Mail,
  Shield,
  Building2,
  Eye,
  EyeOff,
  Loader2,
  Save,
  CheckCircle2,
  XCircle,
  KeyRound,
  Camera,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';
import { fetchUserProfile, userProfileQueryKey, type UserProfileData } from '@/lib/user-profile';
import { UserAvatar } from '@/components/ui/user-avatar';
import { SignatureProfile } from '@/components/profile/signature-profile';

export default function UserProfilePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editName, setEditName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Photo upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Password change
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const {
    data: profileData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: userProfileQueryKey,
    queryFn: ({ signal }) => fetchUserProfile(signal),
  });

  // Sync form fields
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (profileData) {
        if (profileData.name && !editName) setEditName(profileData.name);
        if (profileData.profile?.displayName && !displayName)
          setDisplayName(profileData.profile.displayName);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [displayName, editName, profileData]);

  const handlePhotoFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast({
        title: 'Invalid Format',
        description: 'Only JPEG, PNG, and WebP images are allowed.',
        variant: 'error',
      });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'File Too Large', description: 'Maximum size is 2 MB.', variant: 'error' });
      return;
    }

    // Show local preview immediately
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    // Upload immediately
    setUploadingPhoto(true);
    const formData = new FormData();
    formData.append('file', file);

    fetch('/api/users/upload-avatar', {
      method: 'POST',
      body: formData,
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to upload photo');
        queryClient.setQueryData<UserProfileData>(userProfileQueryKey, (current) =>
          current ? { ...current, image: json.data.imageUrl } : current,
        );
        await queryClient.refetchQueries({ queryKey: userProfileQueryKey, type: 'active' });
        toast({
          title: 'Photo Updated',
          description: 'Your profile photo has been uploaded.',
          variant: 'success',
        });
      })
      .catch((err) => {
        toast({
          title: 'Upload Failed',
          description: err instanceof Error ? err.message : 'Failed to upload photo',
          variant: 'error',
        });
      })
      .finally(() => {
        setUploadingPhoto(false);
        URL.revokeObjectURL(objectUrl);
        setPreviewUrl(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      });
  };

  const handleRemovePhoto = async () => {
    setUploadingPhoto(true);
    try {
      const res = await fetch('/api/users/upload-avatar', { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to remove photo');
      queryClient.setQueryData<UserProfileData>(userProfileQueryKey, (current) =>
        current ? { ...current, image: null } : current,
      );
      await queryClient.refetchQueries({ queryKey: userProfileQueryKey, type: 'active' });
      toast({
        title: 'Photo Removed',
        description: 'Your profile photo has been removed.',
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Remove Failed',
        description: err instanceof Error ? err.message : 'Failed to remove photo',
        variant: 'error',
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/users/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          displayName: displayName.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update profile');
      await queryClient.invalidateQueries({ queryKey: userProfileQueryKey });
      toast({
        title: 'Profile Updated',
        description: 'Your profile has been saved.',
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Update Failed',
        description: err instanceof Error ? err.message : 'Failed to update profile',
        variant: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: 'Passwords do not match',
        description: 'New password and confirmation must match.',
        variant: 'error',
      });
      return;
    }
    if (newPassword.length < 6) {
      toast({
        title: 'Password Too Short',
        description: 'Password must be at least 6 characters.',
        variant: 'error',
      });
      return;
    }

    setChangingPassword(true);
    try {
      const res = await fetch('/api/users/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to change password');
      toast({
        title: 'Password Changed',
        description: 'Your password has been updated successfully.',
        variant: 'success',
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      refetch();
    } catch (err) {
      toast({
        title: 'Password Change Failed',
        description: err instanceof Error ? err.message : 'Failed to change password',
        variant: 'error',
      });
    } finally {
      setChangingPassword(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="text-ink-400 h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Profile" />
        <EmptyState
          icon={<User className="h-6 w-6" />}
          title="Failed to load profile"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!profileData) return null;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'My Profile' }]} />
      <PageHeader title="My Profile" description="Manage your account details and preferences" />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile Summary Sidebar */}
        <Card className="lg:col-span-1">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center">
              <div className="relative mb-4">
                {previewUrl ? (
                  <div className="bg-brand-50 h-24 w-24 overflow-hidden rounded-full">
                    <img
                      src={previewUrl}
                      alt="New profile photo preview"
                      className="h-full w-full animate-pulse object-cover"
                    />
                  </div>
                ) : (
                  <UserAvatar
                    src={profileData.image}
                    name={profileData.name || profileData.email}
                    className="h-24 w-24 rounded-full text-3xl font-bold"
                  />
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handlePhotoFileSelect}
                />
                <div className="absolute right-0 bottom-0 flex">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingPhoto}
                    className="border-border bg-surface text-ink-500 hover:text-ink-700 hover:bg-muted flex h-8 w-8 items-center justify-center rounded-full border shadow-sm transition-colors"
                    title="Change profile photo"
                  >
                    {uploadingPhoto ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Camera className="h-4 w-4" />
                    )}
                  </button>
                  {profileData.image && (
                    <button
                      onClick={handleRemovePhoto}
                      className="border-border bg-surface text-status-error-text hover:bg-status-error-bg ml-1 flex h-8 w-8 items-center justify-center rounded-full border shadow-sm transition-colors"
                      title="Remove profile photo"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <h2 className="text-ink-950 text-lg font-semibold">
                {profileData.name || 'Unnamed'}
              </h2>
              <p className="text-ink-500 text-sm">{profileData.email}</p>
              {profileData.employee && (
                <p className="text-ink-400 mt-1 text-xs">
                  {profileData.employee.jobTitle || 'No title'}
                </p>
              )}

              {/* Roles */}
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {profileData.roles.map((r, i) => (
                  <Badge key={i} variant={r.isActing ? 'pending' : 'info'} size="sm">
                    {r.roleName}
                    {r.isActing ? ' (acting)' : ''}
                  </Badge>
                ))}
              </div>

              {/* Tenant info */}
              <div className="border-border mt-4 w-full space-y-2 border-t pt-4 text-left">
                <div className="text-ink-500 flex items-center gap-2 text-xs">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Tenant:{' '}
                    <span className="text-ink-700 font-medium">{profileData.tenantSlug}</span>
                  </span>
                </div>
                {profileData.employee && (
                  <div className="text-ink-500 flex items-center gap-2 text-xs">
                    <User className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Employee:{' '}
                      <span className="text-ink-700 font-medium">
                        {profileData.employee.employeeNumber}
                      </span>
                    </span>
                  </div>
                )}
                <div className="text-ink-500 flex items-center gap-2 text-xs">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <span>Verified: {profileData.emailVerified ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Personal Details */}
          <Card>
            <CardHeader>
              <CardTitle>Personal Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <div className="flex gap-2">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1"
                    placeholder="Your full name"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Display Name</Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How others see you"
                />
                <p className="text-ink-400 text-xs">
                  Optional. If not set, your full name is used.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={profileData.email} disabled className="bg-muted" />
                <p className="text-ink-400 text-xs">
                  Email cannot be changed. Contact your administrator.
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <Button variant="primary" size="sm" onClick={handleSaveProfile} loading={isSaving}>
                  <Save className="h-4 w-4" /> Save Changes
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Digital Signature</CardTitle>
            </CardHeader>
            <CardContent>
              <SignatureProfile defaultName={profileData.name || ''} />
            </CardContent>
          </Card>

          {/* Change Password */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                Change Password
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {profileData.profile?.requiresPasswordChange && (
                <div className="flex items-center gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300">
                  <Shield className="h-4 w-4 shrink-0" />
                  You are required to change your password before continuing.
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Current Password</Label>
                <div className="relative">
                  <Input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="text-ink-500 hover:text-ink-700 absolute top-1/2 right-3 -translate-y-1/2"
                  >
                    {showCurrentPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>New Password</Label>
                <div className="relative">
                  <Input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 6 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="text-ink-500 hover:text-ink-700 absolute top-1/2 right-3 -translate-y-1/2"
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Confirm New Password</Label>
                <div className="relative">
                  <Input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="text-ink-500 hover:text-ink-700 absolute top-1/2 right-3 -translate-y-1/2"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleChangePassword}
                  loading={changingPassword}
                  disabled={!currentPassword || !newPassword || !confirmPassword}
                >
                  <KeyRound className="h-4 w-4" /> Update Password
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
