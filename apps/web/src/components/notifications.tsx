"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, Check, UserCheck, ArrowRightLeft, MessageSquare, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useNotificationSocket } from "@/lib/socket";
import { authClient } from "@/lib/auth-client";
import type { NotificationDto } from "@soc/shared";

import { playSound } from "@/lib/sounds";

const NOTIFICATION_SOUNDS: Record<string, string> = {
  assigned: "notification.mp3",
  unassigned: "notification.mp3",
  status_changed: "notification.mp3",
  note_added: "notification.mp3",
};

const typeIcons: Record<string, typeof Bell> = {
  assigned: UserCheck,
  unassigned: ArrowRightLeft,
  status_changed: AlertTriangle,
  note_added: MessageSquare,
};

export function NotificationBell() {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;

  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const { data: json } = await api.get("/notifications");
      setNotifications(json.data);
      setUnreadCount(json.meta.unreadCount);
      setLoaded(true);
    } catch {
      // handled by interceptor
    }
  }, []);

  // initial load + unread count
  useEffect(() => {
    if (userId) fetchNotifications();
  }, [userId, fetchNotifications]);

  // real-time notifications
  useNotificationSocket(userId, (notification) => {
    setNotifications((prev) => [notification, ...prev].slice(0, 50));
    setUnreadCount((prev) => prev + 1);
    playSound(NOTIFICATION_SOUNDS[notification.type] || "notification.mp3");
    toast.info(notification.title, {
      description: notification.body || undefined,
    });
  });

  // close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const markRead = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // handled by interceptor
    }
  };

  const markAllRead = async () => {
    try {
      await api.patch("/notifications/read-all");
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // handled by interceptor
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground transition-colors"
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold text-white px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-background border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-medium">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <Check className="size-3" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {!loaded ? (
              <p className="text-xs text-muted-foreground text-center py-6">Loading...</p>
            ) : notifications.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No notifications</p>
            ) : (
              notifications.map((n) => {
                const Icon = typeIcons[n.type] || Bell;
                return (
                  <div
                    key={n.id}
                    className={`flex gap-2.5 px-3 py-2.5 border-b border-border last:border-0 hover:bg-secondary/20 transition-colors cursor-pointer ${
                      !n.read ? "bg-secondary/10" : ""
                    }`}
                    onClick={() => {
                      if (!n.read) markRead(n.id);
                    }}
                  >
                    <div className="mt-0.5">
                      <Icon className={`size-3.5 ${!n.read ? "text-blue-400" : "text-muted-foreground"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs leading-tight ${!n.read ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {n.body}
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground/60 mt-1">
                        {timeAgo(n.createdAt)}
                      </p>
                    </div>
                    {!n.read && (
                      <div className="mt-1.5">
                        <div className="size-2 rounded-full bg-blue-400" />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
