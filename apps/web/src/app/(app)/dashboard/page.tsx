"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart, XAxis, Area, AreaChart } from "recharts";
import { Star, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateCompanyDialog } from "@/components/create-company-dialog";
import api from "@/lib/api";
import { useGlobalSocket } from "@/lib/socket";
import type { CompanyDto, AlertStatsDto, DashboardStatsDto } from "@soc/shared";

const alertsConfig: ChartConfig = {
  critical: { label: "Critical", color: "oklch(0.65 0.20 25)" },
  high: { label: "High", color: "oklch(0.70 0.17 45)" },
  medium: { label: "Medium", color: "oklch(0.75 0.15 70)" },
  low: { label: "Low", color: "oklch(0.60 0.10 250)" },
};

const logVolumeConfig: ChartConfig = {
  logs: { label: "Logs", color: "oklch(0.72 0.10 195)" },
};

export default function Dashboard() {
  const [search, setSearch] = useState("");
  const [companies, setCompanies] = useState<CompanyDto[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [alertStats, setAlertStats] = useState<AlertStatsDto | null>(null);
  const [dashStats, setDashStats] = useState<DashboardStatsDto | null>(null);

  const fetchCompanies = useCallback(async () => {
    try {
      const { data: json } = await api.get("/companies");
      setCompanies(json.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDashStats = useCallback(() => {
    api.get("/dashboard/stats").then(({ data: json }) => setDashStats(json.data)).catch(() => {});
  }, []);

  const fetchAlertStats = useCallback(() => {
    api.get("/alerts/stats").then(({ data: json }) => setAlertStats(json.data)).catch(() => {});
  }, []);

  useEffect(() => {
    fetchCompanies();
    fetchDashStats();
    fetchAlertStats();
    api.get("/favorites")
      .then(({ data: json }) => setFavorites(new Set(json.data)))
      .catch(() => {});
  }, [fetchCompanies, fetchDashStats, fetchAlertStats]);

  useGlobalSocket({
    onLogsIngested: () => fetchDashStats(),
    onLogsCleared: () => fetchDashStats(),
    onAlertCreated: () => { fetchAlertStats(); fetchDashStats(); },
    onAlertUpdated: () => { fetchAlertStats(); },
  });

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      const isFav = next.has(id);
      if (isFav) {
        next.delete(id);
        api.delete(`/favorites/${id}`);
      } else {
        next.add(id);
        api.post(`/favorites/${id}`);
      }
      return next;
    });
  }, []);

  const totalWorkspaces = companies.reduce((sum, c) => sum + c.workspaces, 0);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return companies
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const favA = favorites.has(a.id) ? 0 : 1;
        const favB = favorites.has(b.id) ? 0 : 1;
        if (favA !== favB) return favA - favB;
        return 0;
      });
  }, [search, favorites, companies]);

  const stats = [
    { label: "Companies", value: String(companies.length) },
    { label: "Workspaces", value: String(totalWorkspaces) },
    { label: "Open Alerts", value: String(alertStats ? alertStats.open + alertStats.acknowledged + alertStats.investigating : 0) },
    { label: "Total Logs", value: (dashStats?.totalLogs ?? 0).toLocaleString() },
  ];

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Alerts (7 days)</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {dashStats?.alertsByDay && dashStats.alertsByDay.some((d) => d.critical + d.high + d.medium + d.low > 0) ? (
              <ChartContainer config={alertsConfig} className="h-[160px] w-full">
                <BarChart data={dashStats.alertsByDay}>
                  <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} tickMargin={4} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="critical" stackId="a" fill="var(--color-critical)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="high" stackId="a" fill="var(--color-high)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="medium" stackId="a" fill="var(--color-medium)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="low" stackId="a" fill="var(--color-low)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="text-xs text-muted-foreground py-12 text-center">No alerts in the last 7 days</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Log Volume (24h)</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {dashStats?.logVolume && dashStats.logVolume.some((d) => d.logs > 0) ? (
              <ChartContainer config={logVolumeConfig} className="h-[160px] w-full">
                <AreaChart data={dashStats.logVolume}>
                  <XAxis dataKey="hour" tickLine={false} axisLine={false} fontSize={11} tickMargin={4} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <defs>
                    <linearGradient id="logsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-logs)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--color-logs)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area dataKey="logs" type="monotone" stroke="var(--color-logs)" fill="url(#logsFill)" strokeWidth={1.5} />
                </AreaChart>
              </ChartContainer>
            ) : (
              <p className="text-xs text-muted-foreground py-12 text-center">No logs in the last 24 hours</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Companies</h2>
          <CreateCompanyDialog onCreated={fetchCompanies} />
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

        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((c) => (
              <Link key={c.id} href={`/companies/${c.id}`}>
                <Card className="hover:bg-secondary/30 transition-colors cursor-pointer group h-full">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
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
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 pt-0">
                    <p className="text-xs text-muted-foreground">
                      {c.workspaces} workspaces
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-full py-8 text-center">
                No companies found
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
