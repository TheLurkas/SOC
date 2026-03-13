"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  Area,
  AreaChart,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { CreateWorkspaceDialog } from "@/components/create-workspace-dialog";
import api from "@/lib/api";
import type { CompanyDetailDto } from "@soc/shared";

interface CompanyStats {
  total: number;
  severity: { name: string; value: number }[];
  actions: { name: string; value: number }[];
  eventTypes: { name: string; value: number }[];
  vendors: { name: string; value: number }[];
  topSourceIps: { ip: string; count: number }[];
  topDestIps: { ip: string; count: number }[];
  volume: { time: string; count: number }[];
  openAlerts: number;
  workspaceBreakdown: { name: string; value: number }[];
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "oklch(0.65 0.20 25)",
  high: "oklch(0.70 0.18 40)",
  medium: "oklch(0.75 0.15 70)",
  low: "oklch(0.72 0.10 195)",
  unknown: "oklch(0.55 0.03 250)",
};

const ACTION_COLORS: Record<string, string> = {
  allow: "oklch(0.72 0.15 155)",
  deny: "oklch(0.65 0.20 25)",
  drop: "oklch(0.70 0.18 40)",
  reset: "oklch(0.75 0.15 70)",
};

const WS_COLORS = [
  "oklch(0.72 0.10 195)",
  "oklch(0.72 0.15 155)",
  "oklch(0.70 0.18 40)",
  "oklch(0.75 0.15 70)",
  "oklch(0.65 0.20 25)",
  "oklch(0.55 0.10 280)",
];

const severityChartConfig: ChartConfig = {
  critical: { label: "Critical", color: SEVERITY_COLORS.critical },
  high: { label: "High", color: SEVERITY_COLORS.high },
  medium: { label: "Medium", color: SEVERITY_COLORS.medium },
  low: { label: "Low", color: SEVERITY_COLORS.low },
  unknown: { label: "Unknown", color: SEVERITY_COLORS.unknown },
};

const volumeConfig: ChartConfig = {
  count: { label: "Logs", color: "oklch(0.72 0.10 195)" },
};

const actionConfig: ChartConfig = {
  allow: { label: "Allow", color: ACTION_COLORS.allow },
  deny: { label: "Deny", color: ACTION_COLORS.deny },
  drop: { label: "Drop", color: ACTION_COLORS.drop },
  reset: { label: "Reset", color: ACTION_COLORS.reset },
};

export default function CompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [company, setCompany] = useState<CompanyDetailDto | null>(null);
  const [stats, setStats] = useState<CompanyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchCompany = useCallback(async () => {
    try {
      const { data: json } = await api.get(`/companies/${id}`);
      setCompany(json.data);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchStats = useCallback(() => {
    api.get(`/logs/company/${id}/stats`)
      .then(({ data: json }) => setStats(json.data))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    fetchCompany();
    fetchStats();
  }, [fetchCompany, fetchStats]);

  if (loading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <p className="text-sm text-muted-foreground">{error || "Company not found"}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">{company.name}</h1>
          <p className="text-xs text-muted-foreground">
            {company.workspaces.length} workspaces
            {company.contact && <span className="ml-3">{company.contact}</span>}
          </p>
        </div>
      </div>

      {/* Main two-column layout: workspaces left, stats right */}
      <div className="flex gap-6">
        {/* Left — Workspaces */}
        <div className="w-72 shrink-0 space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">Workspaces</h2>
            <CreateWorkspaceDialog companyId={id} onCreated={fetchCompany} />
          </div>
          <div className="space-y-2">
            {company.workspaces.map((ws) => {
              const wsLogs = stats?.workspaceBreakdown.find((w) => w.name === ws.name);
              return (
                <Link key={ws.id} href={`/companies/${id}/workspaces/${ws.id}`}>
                  <Card className="hover:bg-secondary/30 transition-colors cursor-pointer">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{ws.name}</span>
                        {wsLogs && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {wsLogs.value.toLocaleString()}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {ws.description && <span className="truncate">{ws.description}</span>}
                        {ws.autoResponseEnabled && (
                          <span className="text-emerald-400 shrink-0">auto-response</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
            {company.workspaces.length === 0 && (
              <p className="text-xs text-muted-foreground py-8 text-center">
                No workspaces yet
              </p>
            )}
          </div>
        </div>

        {/* Right — Stats & Charts */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Total Logs</p>
                <p className="text-2xl font-semibold font-mono mt-1">
                  {stats?.total.toLocaleString() ?? "..."}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Open Alerts</p>
                <p className="text-2xl font-semibold font-mono mt-1 flex items-center gap-2">
                  {stats?.openAlerts ?? "..."}
                  {(stats?.openAlerts ?? 0) > 0 && (
                    <AlertTriangle className="size-4 text-orange-400" />
                  )}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Unique Sources</p>
                <p className="text-2xl font-semibold font-mono mt-1">
                  {stats?.topSourceIps.length ?? "..."}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Event Types</p>
                <p className="text-2xl font-semibold font-mono mt-1">
                  {stats?.eventTypes.length ?? "..."}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Vendors</p>
                <p className="text-2xl font-semibold font-mono mt-1">
                  {stats?.vendors.length ?? "..."}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Log volume — full width */}
            <Card className="md:col-span-2">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-medium">Log Volume</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <ChartContainer config={volumeConfig} className="h-[160px] w-full">
                  <AreaChart data={stats?.volume ?? []}>
                    <XAxis dataKey="time" tickLine={false} axisLine={false} fontSize={11} tickMargin={4} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <defs>
                      <linearGradient id="coVolFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-count)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--color-count)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area dataKey="count" type="monotone" stroke="var(--color-count)" fill="url(#coVolFill)" strokeWidth={1.5} />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Severity */}
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-medium">By Severity</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <ChartContainer config={severityChartConfig} className="h-[160px] w-full">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Pie
                      data={stats?.severity ?? []}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={65}
                      paddingAngle={2}
                    >
                      {(stats?.severity ?? []).map((entry) => (
                        <Cell key={entry.name} fill={SEVERITY_COLORS[entry.name] || SEVERITY_COLORS.unknown} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Action */}
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-medium">By Action</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <ChartContainer config={actionConfig} className="h-[160px] w-full">
                  <BarChart data={stats?.actions ?? []} layout="vertical">
                    <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} fontSize={11} width={50} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {(stats?.actions ?? []).map((entry) => (
                        <Cell key={entry.name} fill={ACTION_COLORS[entry.name] || "oklch(0.55 0.03 250)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* By Workspace */}
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-medium">By Workspace</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <ChartContainer config={{ logs: { label: "Logs", color: WS_COLORS[0] } }} className="h-[160px] w-full">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Pie
                      data={stats?.workspaceBreakdown ?? []}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={65}
                      paddingAngle={2}
                    >
                      {(stats?.workspaceBreakdown ?? []).map((_, i) => (
                        <Cell key={i} fill={WS_COLORS[i % WS_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Top source IPs */}
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-medium">Top Source IPs</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-6">
                  {(stats?.topSourceIps ?? []).map(({ ip, count }) => (
                    <div key={ip} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-muted-foreground">{ip}</span>
                      <span className="font-mono font-medium">{count}</span>
                    </div>
                  ))}
                  {stats && stats.topSourceIps.length === 0 && (
                    <p className="text-xs text-muted-foreground">No data</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
