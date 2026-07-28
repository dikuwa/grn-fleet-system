'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  createdAt: string;
  isRead: boolean;
  priority: string;
  entityType: string | null;
  actionUrl: string | null;
}

export interface NotificationFeed {
  notifications: AppNotification[];
  unreadCount: number;
  preferences: {
    emailNotifications: boolean;
    inAppNotifications: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
  };
}

export const notificationQueryKey = ['notifications', 'feed'] as const;
const channelName = 'govfleet-notifications';

export async function fetchNotifications(signal?: AbortSignal): Promise<NotificationFeed> {
  const response = await fetch('/api/notifications?limit=50', {
    signal,
    cache: 'no-store',
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Failed to load notifications');
  return json.data as NotificationFeed;
}

export function broadcastNotificationChange() {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(channelName);
  channel.postMessage({ type: 'refresh' });
  channel.close();
}

export function useNotificationBroadcast() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(channelName);
    channel.onmessage = () => {
      void queryClient.invalidateQueries({ queryKey: notificationQueryKey });
    };
    return () => channel.close();
  }, [queryClient]);
}
