"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { mockCompanies, statusStyle, statusPriority } from "@/lib/mock-data";
import { CreateCompanyDialog } from "@/components/create-company-dialog";

const alertsData = [
  { day: "Mon", critical: 3, warning: 8, info: 12 },
  { day: "Tue", critical: 1, warning: 5, info: 15 },
  { day: "Wed", critical: 5, warning: 11, info: 9 },
  { day: "Thu", critical: 2, warning: 7, info: 14 },
  { day: "Fri", critical: 7, warning: 9, info: 11 },
  { day: "Sat", critical: 4, warning: 6, info: 8 },
  { day: "Sun", critical: 2, warning: 4, info: 10 },
];

const alertsConfig: ChartConfig = {
  critical: { label: "Critical", color: "oklch(0.65 0.20 25)" },
  warning: { label: "Warning", color: "oklch(0.75 0.15 70)" },
  info: { label: "Info", color: "oklch(0.60 0.10 250)" },
};

const logVolumeData = [
  { hour: "00:00", logs: 320 },
  { hour: "02:00", logs: 180 },
  { hour: "04:00", logs: 140 },
  { hour: "06:00", logs: 280 },
  { hour: "08:00", logs: 890 },
  { hour: "10:00", logs: 1240 },
  { hour: "12:00", logs: 1100 },
  { hour: "14:00", logs: 1380 },
  { hour: "16:00", logs: 1520 },
  { hour: "18:00", logs: 980 },
  { hour: "20:00", logs: 640 },
  { hour: "22:00", logs: 420 },
];

const logVolumeConfig: ChartConfig = {
  logs: { label: "Logs", color: "oklch(0.72 0.10 195)" },
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Alerts (7 days)</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <ChartContainer config={alertsConfig} className="h-[160px] w-full">
              <BarChart data={alertsData}>
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} tickMargin={4} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="critical" stackId="a" fill="var(--color-critical)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="warning" stackId="a" fill="var(--color-warning)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="info" stackId="a" fill="var(--color-info)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Log Volume (24h)</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <ChartContainer config={logVolumeConfig} className="h-[160px] w-full">
              <AreaChart data={logVolumeData}>
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
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Companies</h2>
          <CreateCompanyDialog />
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
            </Link>
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
