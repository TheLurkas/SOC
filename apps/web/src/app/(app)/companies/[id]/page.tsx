"use client";

import { use } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import {
  mockCompanies,
  mockWorkspaces,
  statusStyle,
  statusPriority,
} from "@/lib/mock-data";
import { CreateWorkspaceDialog } from "@/components/create-workspace-dialog";

export default function CompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const company = mockCompanies.find((c) => c.id === id);
  const workspaces = mockWorkspaces
    .filter((w) => w.companyId === id)
    .sort((a, b) => statusPriority[a.status] - statusPriority[b.status]);

  if (!company) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <p className="text-sm text-muted-foreground">Company not found</p>
      </div>
    );
  }

  const totalLogs = workspaces.reduce((sum, w) => sum + w.logsToday, 0);
  const totalAlerts = workspaces.reduce((sum, w) => sum + w.alerts, 0);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
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
            {workspaces.length} workspaces · {totalAlerts} alerts · {totalLogs.toLocaleString()} logs today
          </p>
        </div>
        <Badge variant="outline" className={`ml-auto ${statusStyle[company.status]}`}>
          {company.status}
        </Badge>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Workspaces</h2>
          <CreateWorkspaceDialog companyId={id} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {workspaces.map((ws) => (
            <Link key={ws.id} href={`/companies/${id}/workspaces/${ws.id}`}>
              <Card className="hover:bg-secondary/30 transition-colors cursor-pointer h-full">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{ws.name}</CardTitle>
                    <Badge variant="outline" className={statusStyle[ws.status]}>
                      {ws.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-0">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{ws.logsToday.toLocaleString()} logs today</span>
                    {ws.alerts > 0 && (
                      <span className="text-amber-400">{ws.alerts} alerts</span>
                    )}
                    {ws.autoResponseEnabled && (
                      <span className="text-primary">auto-response on</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
