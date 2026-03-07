"use client";

import { use } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { mockCompanies, mockWorkspaces, statusStyle } from "@/lib/mock-data";

export default function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string; wsId: string }>;
}) {
  const { id, wsId } = use(params);
  const company = mockCompanies.find((c) => c.id === id);
  const workspace = mockWorkspaces.find((w) => w.id === wsId);

  if (!company || !workspace) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <p className="text-sm text-muted-foreground">Workspace not found</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <Link
          href={`/companies/${id}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <p className="text-xs text-muted-foreground">{company.name}</p>
          <h1 className="text-lg font-semibold">{workspace.name}</h1>
        </div>
        <Badge variant="outline" className={`ml-auto ${statusStyle[workspace.status]}`}>
          {workspace.status}
        </Badge>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Logs Today</p>
            <p className="text-2xl font-semibold font-mono mt-1">
              {workspace.logsToday.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Open Alerts</p>
            <p className="text-2xl font-semibold font-mono mt-1">{workspace.alerts}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Auto-Response</p>
            <p className="text-2xl font-semibold font-mono mt-1">
              {workspace.autoResponseEnabled ? "On" : "Off"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="text-2xl font-semibold font-mono mt-1 capitalize">
              {workspace.status}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="text-sm text-muted-foreground">
        Log viewer and alerts.
      </div>
    </div>
  );
}
