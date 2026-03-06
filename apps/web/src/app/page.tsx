"use client";

import { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Star, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "healthy" | "warning" | "critical";

interface Company {
  id: string;
  name: string;
  workspaces: number;
  status: Status;
  alerts: number;
}

const mockCompanies: Company[] = [
  { id: "1", name: "Acme Corp", workspaces: 3, status: "healthy", alerts: 0 },
  { id: "2", name: "TechStart Inc", workspaces: 1, status: "warning", alerts: 2 },
  { id: "3", name: "Global Finance Ltd", workspaces: 4, status: "critical", alerts: 7 },
  { id: "4", name: "MedSecure Health", workspaces: 2, status: "critical", alerts: 12 },
  { id: "5", name: "Retail Solutions", workspaces: 1, status: "healthy", alerts: 0 },
  { id: "6", name: "DataFlow Systems", workspaces: 2, status: "warning", alerts: 1 },
];

const statusStyle: Record<Status, string> = {
  healthy: "text-emerald-400 border-emerald-500/30",
  warning: "text-amber-400 border-amber-500/30",
  critical: "text-red-400 border-red-500/30",
};

const statusPriority: Record<Status, number> = {
  critical: 0,
  warning: 1,
  healthy: 2,
};

const stats = [
  { label: "Companies", value: "6" },
  { label: "Workspaces", value: "13" },
  { label: "Open Alerts", value: "22" },
  { label: "Logs (24h)", value: "14.2k" },
];

export default function Dashboard() {
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(new Set(["3", "4"]));

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return mockCompanies
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const favA = favorites.has(a.id) ? 0 : 1;
        const favB = favorites.has(b.id) ? 0 : 1;
        if (favA !== favB) return favA - favB;
        return statusPriority[a.status] - statusPriority[b.status];
      });
  }, [search, favorites]);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <h1 className="text-lg font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-semibold font-mono mt-1">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Companies</h2>
          <div className="relative ml-auto w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search companies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((c) => (
            <Card
              key={c.id}
              className="hover:bg-secondary/30 transition-colors cursor-pointer group"
            >
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(c.id);
                      }}
                      className="text-muted-foreground hover:text-amber-400 transition-colors"
                    >
                      <Star
                        className={cn(
                          "size-3.5",
                          favorites.has(c.id) && "fill-amber-400 text-amber-400"
                        )}
                      />
                    </button>
                    <CardTitle className="text-sm">{c.name}</CardTitle>
                  </div>
                  <Badge variant="outline" className={statusStyle[c.status]}>
                    {c.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-xs text-muted-foreground">
                  {c.workspaces} workspaces
                  {c.alerts > 0 && (
                    <span className="text-amber-400 ml-3">
                      {c.alerts} alerts
                    </span>
                  )}
                </p>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full py-8 text-center">
              No companies found
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
