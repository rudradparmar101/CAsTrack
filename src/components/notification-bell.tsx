'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, Check, CheckCheck, MessageSquare, UserPlus, AlertTriangle, CheckCircle2, FileText } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from '@/app/(dashboard)/notifications-actions';
import type { Notification, NotificationType } from '@/lib/types';

const typeConfig: Record<NotificationType, { icon: React.ElementType; color: string }> = {
  task_assigned: { icon: UserPlus, color: 'text-[var(--color-accent)]' },
  comment_added: { icon: MessageSquare, color: 'text-[var(--color-info)]' },
  mentioned_in_comment: { icon: MessageSquare, color: 'text-[var(--color-info)]' },
  due_date_approaching: { icon: AlertTriangle, color: 'text-[var(--color-warning)]' },
  task_overdue: { icon: AlertTriangle, color: 'text-[var(--color-danger)]' },
  task_completed: { icon: CheckCircle2, color: 'text-[var(--color-success)]' },
  approval_requested: { icon: Check, color: 'text-[var(--color-accent)]' },
  task_approved: { icon: CheckCircle2, color: 'text-[var(--color-success)]' },
  task_rejected: { icon: AlertTriangle, color: 'text-[var(--color-danger)]' },
  document_uploaded: { icon: FileText, color: 'text-[var(--color-info)]' },
};

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const fetchNotifications = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (data) {
        setNotifications(data as Notification[]);
      }
    } catch {
      // notifications table may not exist
    }
  }, []);

  // Fetch on mount and set up polling
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleMarkRead = async (id: string) => {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    await markNotificationReadAction(id);
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0) return;
    setLoading(true);
    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await markAllNotificationsReadAction();
    setLoading(false);
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) {
      handleMarkRead(notification.id);
    }
    // Navigate to the referenced item if applicable
    if (notification.reference_type === 'task' && notification.reference_id) {
      window.location.href = `/tasks/${notification.reference_id}`;
    }
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchNotifications();
        }}
        className="relative p-2 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-muted)] transition-colors focus-ring"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4.5 min-w-[18px] px-1 flex items-center justify-center rounded-full bg-[var(--color-danger)] text-[var(--color-danger-foreground)] text-[10px] font-bold leading-none animate-scale-in">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-lg z-50 animate-scale-in overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              Notifications
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                disabled={loading}
                className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors flex items-center gap-1"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length > 0 ? (
              notifications.map((notification) => {
                const cfg = typeConfig[notification.type as NotificationType] || typeConfig.task_assigned;
                const Icon = cfg.icon;

                return (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-[var(--color-muted)] transition-colors border-b border-[var(--color-border)] last:border-b-0 ${
                      !notification.is_read ? 'bg-[var(--color-accent-muted)]/30' : ''
                    }`}
                  >
                    {/* Icon */}
                    <div className={`shrink-0 mt-0.5 ${cfg.color}`}>
                      <Icon className="h-4.5 w-4.5" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!notification.is_read ? 'font-medium text-[var(--color-text)]' : 'text-[var(--color-text-secondary)]'}`}>
                        {notification.title}
                      </p>
                      {notification.message && (
                        <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">
                          {notification.message}
                        </p>
                      )}
                      <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                        {formatDistanceToNow(new Date(notification.created_at), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>

                    {/* Unread dot */}
                    {!notification.is_read && (
                      <div className="shrink-0 mt-2">
                        <span className="block h-2 w-2 rounded-full bg-[var(--color-accent)]" />
                      </div>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="py-8 text-center">
                <Bell className="h-8 w-8 text-[var(--color-text-muted)] mx-auto mb-2" />
                <p className="text-sm text-[var(--color-text-secondary)]">
                  No notifications yet
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
