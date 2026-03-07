"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import api from "@/lib/api";

interface WorkspaceDetail {
  id: string;
  name: string;
  description: string | null;
  autoResponseEnabled: boolean;
  createdAt: string;
  company: { id: string; name: string };
}

export default function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string; wsId: string }>;
}) {
  const { id, wsId } = use(params);
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/companies/${id}/workspaces/${wsId}`)
      .then(({ data: json }) => setWorkspace(json.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, wsId]);

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!workspace) {
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
          <p className="text-xs text-muted-foreground">{workspace.company.name}</p>
          <h1 className="text-lg font-semibold">{workspace.name}</h1>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Logs Today</p>
            <p className="text-2xl font-semibold font-mono mt-1">0</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Open Alerts</p>
            <p className="text-2xl font-semibold font-mono mt-1">0</p>
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
            <p className="text-xs text-muted-foreground">Description</p>
            <p className="text-sm font-medium mt-1">
              {workspace.description || "No description"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="text-sm text-muted-foreground">
        Log viewer and alerts coming soon.
      </div>
    </div>
  );
}
