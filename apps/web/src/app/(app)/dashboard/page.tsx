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
import { Bar, BarChart, XAxis, YAxis, Area, AreaChart, Cell } from "recharts";
import {
  ComposableMap,
  Geographies,
  Geography,
  Graticule,
  Sphere,
} from "react-simple-maps";
import { Star, Search, Globe, AlertTriangle, Activity, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateCompanyDialog } from "@/components/create-company-dialog";
import { GenerateReportDialog } from "@/components/generate-report-dialog";
import api from "@/lib/api";
import { useGlobalSocket } from "@/lib/socket";
import type { CompanyDto, AlertStatsDto, DashboardStatsDto } from "@soc/shared";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const alertsConfig: ChartConfig = {
  critical: { label: "Critical", color: "oklch(0.65 0.20 25)" },
  high: { label: "High", color: "oklch(0.70 0.17 45)" },
  medium: { label: "Medium", color: "oklch(0.75 0.15 70)" },
  low: { label: "Low", color: "oklch(0.60 0.10 250)" },
};

const logVolumeConfig: ChartConfig = {
  logs: { label: "Logs", color: "oklch(0.72 0.10 195)" },
};

const companyConfig: ChartConfig = {
  alerts: { label: "Alerts", color: "oklch(0.72 0.10 195)" },
};

const COMPANY_COLORS = [
  "oklch(0.72 0.10 195)",
  "oklch(0.72 0.15 155)",
  "oklch(0.70 0.18 40)",
  "oklch(0.75 0.15 70)",
  "oklch(0.65 0.20 25)",
  "oklch(0.55 0.10 280)",
];

export default function Dashboard() {
  const [search, setSearch] = useState("");
  const [companies, setCompanies] = useState<CompanyDto[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [alertStats, setAlertStats] = useState<AlertStatsDto | null>(null);
  const [dashStats, setDashStats] = useState<DashboardStatsDto | null>(null);
  const [tooltipContent, setTooltipContent] = useState("");

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

  const openAlerts = alertStats ? alertStats.open + alertStats.acknowledged + alertStats.investigating : 0;

  // build country heatmap lookup — maps country name to a fill color
  const countryHeat = useMemo(() => {
    const heatmap = dashStats?.countryHeatmap;
    if (!heatmap || heatmap.length === 0) return new Map<string, { count: number; color: string }>();

    const maxCount = Math.max(...heatmap.map((c) => c.count));
    const map = new Map<string, { count: number; color: string }>();
    for (const { country, count } of heatmap) {
      // intensity 0-1 based on log count
      const t = maxCount > 0 ? count / maxCount : 0;
      // interpolate from dark teal to bright red
      const lightness = 0.30 + t * 0.25;
      const chroma = 0.05 + t * 0.20;
      const hue = 200 - t * 175; // 200 (teal) → 25 (red)
      map.set(country, { count, color: `oklch(${lightness} ${chroma} ${hue})` });
    }
    return map;
  }, [dashStats?.countryHeatmap]);

  return (
    <div className="p-6 space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <div className="flex items-center gap-4">
          <GenerateReportDialog companies={companies} />
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="size-2 rounded-full bg-blue-400" />
              <span>Low</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="size-2 rounded-full bg-yellow-400" />
              <span>Medium</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="size-2 rounded-full bg-orange-400" />
              <span>High</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="size-2 rounded-full bg-red-400" />
              <span>Critical</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Left — Companies sidebar */}
        <div className="w-64 shrink-0 space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">Companies</h2>
            <CreateCompanyDialog onCreated={fetchCompanies} />
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
            {loading ? (
              <p className="text-xs text-muted-foreground py-8 text-center">Loading...</p>
            ) : (
              <>
                {filtered.map((c) => (
                  <Link key={c.id} href={`/companies/${c.id}`}>
                    <Card className="hover:bg-secondary/30 transition-colors cursor-pointer">
                      <CardContent className="p-2.5">
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
                                "size-3",
                                favorites.has(c.id) && "fill-amber-400 text-amber-400"
                              )}
                            />
                          </button>
                          <span className="text-sm font-medium truncate">{c.name}</span>
                          <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                            {c.workspaces}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
                {filtered.length === 0 && (
                  <p className="text-xs text-muted-foreground py-8 text-center">
                    No companies found
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right — Main content */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Threat Map + KPI column */}
          <div className="flex gap-2">
            <Card className="flex-1 min-w-0 p-0">
              <div className="flex items-center justify-between px-3 pt-2">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Globe className="size-3.5 text-muted-foreground" />
                  Threat Map
                </div>
                {tooltipContent && (
                  <span className="text-[11px] text-muted-foreground">{tooltipContent}</span>
                )}
              </div>
              <div className="px-2 pb-2 pt-1">
                <div className="w-full rounded overflow-hidden bg-zinc-950/50">
                  <ComposableMap
                    projection="geoMercator"
                    projectionConfig={{ scale: 80, center: [15, 35] }}
                    width={900}
                    height={300}
                    style={{ width: "100%", height: "auto", display: "block" }}
                  >
                    <Sphere id="sphere" fill="transparent" stroke="oklch(0.25 0.01 250)" strokeWidth={0.3} />
                    <Graticule stroke="oklch(0.20 0.01 250)" strokeWidth={0.2} />
                    <Geographies geography={GEO_URL}>
                      {({ geographies }) =>
                        geographies.map((geo) => {
                          const name = geo.properties.name || "";
                          const heat = countryHeat.get(name);
                          const defaultFill = heat ? heat.color : "oklch(0.22 0.015 250)";
                          const label = heat ? `${name} — ${heat.count.toLocaleString()} logs` : name;
                          return (
                            <Geography
                              key={geo.rsmKey}
                              geography={geo}
                              onMouseEnter={() => setTooltipContent(label)}
                              onMouseLeave={() => setTooltipContent("")}
                              style={{
                                default: { fill: defaultFill, stroke: "oklch(0.30 0.02 250)", strokeWidth: 0.4, outline: "none" },
                                hover: { fill: heat ? heat.color : "oklch(0.30 0.04 220)", stroke: "oklch(0.45 0.03 250)", strokeWidth: 0.6, outline: "none" },
                                pressed: { fill: "oklch(0.28 0.03 220)", outline: "none" },
                              }}
                            />
                          );
                        })
                      }
                    </Geographies>
                  </ComposableMap>
                </div>
              </div>
            </Card>

            {/* KPI column */}
            <div className="w-28 shrink-0 flex flex-col gap-2">
              <Card className="flex-1">
                <CardContent className="p-2 flex flex-col items-center justify-center h-full gap-0.5">
                  <Shield className="size-3.5 text-blue-400" />
                  <p className="text-[9px] text-muted-foreground leading-none">Companies</p>
                  <p className="text-lg font-semibold font-mono leading-none">{companies.length}</p>
                </CardContent>
              </Card>
              <Card className="flex-1">
                <CardContent className="p-2 flex flex-col items-center justify-center h-full gap-0.5">
                  <Globe className="size-3.5 text-teal-400" />
                  <p className="text-[9px] text-muted-foreground leading-none">Workspaces</p>
                  <p className="text-lg font-semibold font-mono leading-none">{totalWorkspaces}</p>
                </CardContent>
              </Card>
              <Card className="flex-1">
                <CardContent className="p-2 flex flex-col items-center justify-center h-full gap-0.5">
                  <AlertTriangle className={cn("size-3.5", openAlerts > 0 ? "text-red-400" : "text-zinc-400")} />
                  <p className="text-[9px] text-muted-foreground leading-none">Open Alerts</p>
                  <p className={cn("text-lg font-semibold font-mono leading-none", openAlerts > 0 && "text-red-400")}>{openAlerts}</p>
                </CardContent>
              </Card>
              <Card className="flex-1">
                <CardContent className="p-2 flex flex-col items-center justify-center h-full gap-0.5">
                  <Activity className="size-3.5 text-emerald-400" />
                  <p className="text-[9px] text-muted-foreground leading-none">Total Logs</p>
                  <p className="text-lg font-semibold font-mono leading-none">{(dashStats?.totalLogs ?? 0).toLocaleString()}</p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Log Volume — compact strip */}
          <Card>
            <CardHeader className="p-3 pb-0">
              <CardTitle className="text-sm font-medium">Log Volume (24h)</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-1">
              {dashStats?.logVolume && dashStats.logVolume.some((d) => d.logs > 0) ? (
                <ChartContainer config={logVolumeConfig} className="h-[100px] w-full">
                  <AreaChart data={dashStats.logVolume}>
                    <XAxis dataKey="hour" tickLine={false} axisLine={false} fontSize={10} tickMargin={4} />
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
                <p className="text-xs text-muted-foreground py-8 text-center">No logs in the last 24 hours</p>
              )}
            </CardContent>
          </Card>

          {/* Alerts + Alerts by Company — side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <CardHeader className="p-3 pb-0">
                <CardTitle className="text-sm font-medium">Alerts (7 days)</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-1">
                {dashStats?.alertsByDay && dashStats.alertsByDay.some((d) => d.critical + d.high + d.medium + d.low > 0) ? (
                  <ChartContainer config={alertsConfig} className="h-[140px] w-full">
                    <BarChart data={dashStats.alertsByDay}>
                      <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={10} tickMargin={4} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="critical" stackId="a" fill="var(--color-critical)" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="high" stackId="a" fill="var(--color-high)" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="medium" stackId="a" fill="var(--color-medium)" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="low" stackId="a" fill="var(--color-low)" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <p className="text-xs text-muted-foreground py-8 text-center">No alerts in the last 7 days</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-3 pb-0">
                <CardTitle className="text-sm font-medium">Alerts by Company</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-1">
                {dashStats?.alertsByCompany && dashStats.alertsByCompany.length > 0 ? (
                  <ChartContainer config={companyConfig} className="h-[140px] w-full">
                    <BarChart data={dashStats.alertsByCompany} layout="vertical">
                      <XAxis type="number" tickLine={false} axisLine={false} fontSize={10} />
                      <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} fontSize={10} width={80} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="alerts" radius={[0, 4, 4, 0]}>
                        {dashStats.alertsByCompany.map((_, i) => (
                          <Cell key={i} fill={COMPANY_COLORS[i % COMPANY_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <p className="text-xs text-muted-foreground py-8 text-center">No alert data yet</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
