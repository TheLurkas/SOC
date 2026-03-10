"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { MessageSquare, LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/alerts", label: "Alerts" },
];

interface NavbarProps {
  onChatToggle: () => void;
  chatOpen: boolean;
}

export function Navbar({ onChatToggle, chatOpen }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const isAdmin = (session?.user as any)?.role === "admin";

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="flex h-12 items-center px-6 gap-8">
        <Link href="/dashboard" className="flex items-center gap-2">
          <img src="/logo.png" alt="Lurkas" className="h-10" />
        </Link>

        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "px-3 py-1 text-sm rounded-md transition-colors",
                  isActive
                    ? "text-foreground bg-secondary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {item.label}
              </Link>
            );
          })}
          {isAdmin && (
            <Link
              href="/users"
              className={cn(
                "px-3 py-1 text-sm rounded-md transition-colors",
                pathname.startsWith("/users")
                  ? "text-foreground bg-secondary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Users
            </Link>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-1">
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
