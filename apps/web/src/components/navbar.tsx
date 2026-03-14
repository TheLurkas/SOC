"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { MessageSquare, LogOut, LayoutDashboard, AlertTriangle, ShieldCheck, BarChart3, Users } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { NotificationBell } from "@/components/notifications";
import { useGlobalSocket } from "@/lib/socket";
import { playSound } from "@/lib/sounds";
import api from "@/lib/api";

interface NavbarProps {
  onChatToggle: () => void;
  chatOpen: boolean;
}

export function Navbar({ onChatToggle, chatOpen }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const isAdmin = (session?.user as any)?.role === "admin";
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const onAlertsPage = pathname.startsWith("/alerts");

  const STORAGE_KEY = "lastSeenAlertsAt";

  // fetch unread count: alerts created after lastSeenAlertsAt
  useEffect(() => {
    const lastSeen = localStorage.getItem(STORAGE_KEY);
    if (lastSeen) {
      api.get("/alerts", { params: { from: lastSeen, limit: 1 } }).then(({ data: json }) => {
        setUnreadAlerts(json.meta?.total ?? 0);
      }).catch(() => {});
    } else {
      // no timestamp stored yet — count all open alerts
      api.get("/alerts/stats").then(({ data: json }) => {
        const open = json.data.byStatus?.find((s: any) => s.status === "open")?._count ?? 0;
        setUnreadAlerts(open);
      }).catch(() => {});
    }
  }, []);

  // mark as seen when user navigates to /alerts
  useEffect(() => {
    if (onAlertsPage) {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
      setUnreadAlerts(0);
    }
  }, [onAlertsPage]);

  // listen for new alerts via websocket
  useGlobalSocket({
    onAlertCreated: () => {
      if (!onAlertsPage) {
        setUnreadAlerts((prev) => prev + 1);
        playSound("alert.mp3");
      }
    },
  });

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="flex h-12 items-center px-6 gap-8">
        <Link href="/dashboard" className="flex items-center gap-2">
          <img src="/logo.png" alt="Lurkas" className="h-10" />
        </Link>

        <nav className="flex items-center gap-1">
          <Link
            href="/dashboard"
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 text-sm rounded-md transition-colors",
              pathname.startsWith("/dashboard")
                ? "text-foreground bg-secondary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <LayoutDashboard className="size-3.5" />
            Dashboard
          </Link>
          <Link
            href="/alerts"
            className={cn(
              "relative flex items-center gap-1.5 px-3 py-1 text-sm rounded-md transition-colors",
              onAlertsPage
                ? "text-foreground bg-secondary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <AlertTriangle className="size-3.5" />
            Alerts
            {unreadAlerts > 0 && !onAlertsPage && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold text-white px-1">
                {unreadAlerts > 99 ? "99+" : unreadAlerts}
              </span>
            )}
          </Link>
          {isAdmin && (
            <>
              <Link
                href="/rules"
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 text-sm rounded-md transition-colors",
                  pathname.startsWith("/rules")
                    ? "text-foreground bg-secondary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ShieldCheck className="size-3.5" />
                Rules
              </Link>
              <Link
                href="/usage"
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 text-sm rounded-md transition-colors",
                  pathname.startsWith("/usage")
                    ? "text-foreground bg-secondary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <BarChart3 className="size-3.5" />
                Usage
              </Link>
              <Link
                href="/users"
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 text-sm rounded-md transition-colors",
                  pathname.startsWith("/users")
                    ? "text-foreground bg-secondary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Users className="size-3.5" />
                Users
              </Link>
            </>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <NotificationBell />
          <button
            onClick={onChatToggle}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 text-sm rounded-md transition-colors",
              chatOpen
                ? "text-foreground bg-secondary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <MessageSquare className="size-3.5" />
            Chat
          </button>
          <button
            onClick={async () => {
              await authClient.signOut();
              router.push("/login");
            }}
            className="flex items-center gap-1.5 px-3 py-1 text-sm rounded-md text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
