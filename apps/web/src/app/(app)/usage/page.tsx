"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart, XAxis, YAxis, PieChart, Pie, Cell } from "recharts";
import api from "@/lib/api";

interface UsageData {
  totals: {
    calls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  };
  byPurpose: { purpose: string; calls: number; tokens: number; costUsd: number }[];
  byCompany: { companyId: string; companyName: string; calls: number; tokens: number; costUsd: number }[];
  byUser: { userId: string; userName: string; calls: number; tokens: number; costUsd: number }[];
  recent: {
    id: string;
    model: string;
    purpose: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    companyName: string | null;
    userName: string | null;
    createdAt: string;
  }[];
}

const PURPOSE_COLORS: Record<string, string> = {
  query: "oklch(0.72 0.10 195)",
  answer: "oklch(0.72 0.15 155)",
  title: "oklch(0.75 0.15 70)",
  auto_response: "oklch(0.65 0.20 25)",
  report: "oklch(0.68 0.15 300)",
  alert_analysis: "oklch(0.70 0.18 40)",
};

const PURPOSE_LABELS: Record<string, string> = {
  query: "Log Query",
  answer: "Chat Response",
  title: "Title Generation",
  auto_response: "Auto Response",
  report: "Report Generation",
  alert_analysis: "Alert Analysis",
};

const COMPANY_COLORS = [
  "oklch(0.72 0.10 195)",
  "oklch(0.72 0.15 155)",
  "oklch(0.70 0.18 40)",
  "oklch(0.75 0.15 70)",
  "oklch(0.65 0.20 25)",
  "oklch(0.55 0.10 280)",
];

const purposeConfig: ChartConfig = {
  query: { label: PURPOSE_LABELS.query, color: PURPOSE_COLORS.query },
  answer: { label: PURPOSE_LABELS.answer, color: PURPOSE_COLORS.answer },
  title: { label: PURPOSE_LABELS.title, color: PURPOSE_COLORS.title },
  auto_response: { label: PURPOSE_LABELS.auto_response, color: PURPOSE_COLORS.auto_response },
  report: { label: PURPOSE_LABELS.report, color: PURPOSE_COLORS.report },
  alert_analysis: { label: PURPOSE_LABELS.alert_analysis, color: PURPOSE_COLORS.alert_analysis },
};

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function UsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/usage")
      .then(({ data: json }) => setData(json.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <p className="text-sm text-muted-foreground">Failed to load usage data</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-lg font-semibold">LLM Usage</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Token consumption and cost tracking across all AI operations
        </p>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Cost</p>
            <p className="text-2xl font-semibold font-mono mt-1">
              {formatCost(data.totals.costUsd)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">API Calls</p>
            <p className="text-2xl font-semibold font-mono mt-1">
              {data.totals.calls.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Tokens</p>
            <p className="text-2xl font-semibold font-mono mt-1">
              {formatTokens(data.totals.totalTokens)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Prompt Tokens</p>
            <p className="text-2xl font-semibold font-mono mt-1">
              {formatTokens(data.totals.promptTokens)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Completion Tokens</p>
            <p className="text-2xl font-semibold font-mono mt-1">
              {formatTokens(data.totals.completionTokens)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* By Purpose */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Cost by Purpose</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <ChartContainer config={purposeConfig} className="h-[160px] w-full">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent />} />
                <Pie
                  data={data.byPurpose.map((p) => ({ name: PURPOSE_LABELS[p.purpose] || p.purpose, value: p.costUsd }))}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={65}
                  paddingAngle={2}
                >
                  {data.byPurpose.map((p) => (
                    <Cell key={p.purpose} fill={PURPOSE_COLORS[p.purpose] || "oklch(0.55 0.03 250)"} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* By Company */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Cost by Company</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {data.byCompany.length > 0 ? (
              <ChartContainer config={{ cost: { label: "Cost", color: COMPANY_COLORS[0] } }} className="h-[160px] w-full">
                <BarChart data={data.byCompany.map((c) => ({ name: c.companyName, value: c.costUsd }))} layout="vertical">
                  <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} fontSize={11} width={80} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {data.byCompany.map((_, i) => (
                      <Cell key={i} fill={COMPANY_COLORS[i % COMPANY_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="text-xs text-muted-foreground py-8 text-center">No data yet</p>
            )}
          </CardContent>
        </Card>

        {/* By User */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Cost by User</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {data.byUser.length > 0 ? (
              <ChartContainer config={{ cost: { label: "Cost", color: COMPANY_COLORS[0] } }} className="h-[160px] w-full">
                <BarChart data={data.byUser.map((u) => ({ name: u.userName, value: u.costUsd }))} layout="vertical">
                  <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} fontSize={11} width={80} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {data.byUser.map((_, i) => (
                      <Cell key={i} fill={COMPANY_COLORS[i % COMPANY_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="text-xs text-muted-foreground py-8 text-center">No data yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Breakdown tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Purpose breakdown */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">By Purpose</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-2 font-medium">Operation</th>
                  <th className="text-right p-2 font-medium">API Calls</th>
                  <th className="text-right p-2 font-medium">Tokens Used</th>
                  <th className="text-right p-2 font-medium">Cost (USD)</th>
                </tr>
              </thead>
              <tbody>
                {data.byPurpose.map((p) => (
                  <tr key={p.purpose} className="border-b border-border/50">
                    <td className="p-2">{PURPOSE_LABELS[p.purpose] || p.purpose}</td>
                    <td className="p-2 text-right font-mono">{p.calls}</td>
                    <td className="p-2 text-right font-mono">{formatTokens(p.tokens)}</td>
                    <td className="p-2 text-right font-mono">{formatCost(p.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Company breakdown */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">By Company</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {data.byCompany.length > 0 ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left p-2 font-medium">Company</th>
                    <th className="text-right p-2 font-medium">Calls</th>
                    <th className="text-right p-2 font-medium">Tokens</th>
                    <th className="text-right p-2 font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byCompany.map((c) => (
                    <tr key={c.companyId} className="border-b border-border/50">
                      <td className="p-2">{c.companyName}</td>
                      <td className="p-2 text-right font-mono">{c.calls}</td>
                      <td className="p-2 text-right font-mono">{formatTokens(c.tokens)}</td>
                      <td className="p-2 text-right font-mono">{formatCost(c.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-muted-foreground py-4 text-center">No company-scoped usage yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent calls */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium">Recent API Calls</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-2 font-medium">When</th>
                  <th className="text-left p-2 font-medium">Operation</th>
                  <th className="text-left p-2 font-medium">AI Model</th>
                  <th className="text-left p-2 font-medium">Triggered By</th>
                  <th className="text-left p-2 font-medium">Client</th>
                  <th className="text-right p-2 font-medium">Input Tokens</th>
                  <th className="text-right p-2 font-medium">Output Tokens</th>
                  <th className="text-right p-2 font-medium">Cost (USD)</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      No API calls recorded yet
                    </td>
                  </tr>
                ) : (
                  data.recent.map((r) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-secondary/30">
                      <td className="p-2 text-muted-foreground whitespace-nowrap">{timeAgo(r.createdAt)}</td>
                      <td className="p-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          r.purpose === 'answer' ? 'bg-emerald-500/15 text-emerald-400'
                          : r.purpose === 'query' ? 'bg-blue-500/15 text-blue-400'
                          : r.purpose === 'title' ? 'bg-yellow-500/15 text-yellow-400'
                          : r.purpose === 'report' ? 'bg-purple-500/15 text-purple-400'
                          : r.purpose === 'alert_analysis' ? 'bg-orange-500/15 text-orange-400'
                          : 'bg-red-500/15 text-red-400'
                        }`}>
                          {PURPOSE_LABELS[r.purpose] || r.purpose}
                        </span>
                      </td>
                      <td className="p-2 font-mono">{r.model}</td>
                      <td className="p-2">{r.userName || "-"}</td>
                      <td className="p-2">{r.companyName || "-"}</td>
                      <td className="p-2 text-right font-mono">{r.promptTokens.toLocaleString()}</td>
                      <td className="p-2 text-right font-mono">{r.completionTokens.toLocaleString()}</td>
                      <td className="p-2 text-right font-mono">{formatCost(r.costUsd)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
