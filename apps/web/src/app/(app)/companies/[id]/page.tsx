"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { CreateWorkspaceDialog } from "@/components/create-workspace-dialog";
import api from "@/lib/api";

interface Workspace {
  id: string;
  name: string;
  description: string | null;
  autoResponseEnabled: boolean;
  createdAt: string;
}

interface CompanyDetail {
  id: string;
  name: string;
  contact: string | null;
  workspaces: Workspace[];
  workspaceCount: number;
}

export default function CompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [company, setCompany] = useState<CompanyDetail | null>(null);
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

  useEffect(() => {
    fetchCompany();
  }, [fetchCompany]);

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <p className="text-sm text-muted-foreground">{error || "Company not found"}</p>
      </div>
    );
  }

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
            {company.workspaces.length} workspaces
            {company.contact && <span className="ml-3">{company.contact}</span>}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Workspaces</h2>
          <CreateWorkspaceDialog companyId={id} onCreated={fetchCompany} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {company.workspaces.map((ws) => (
            <Link key={ws.id} href={`/companies/${id}/workspaces/${ws.id}`}>
              <Card className="hover:bg-secondary/30 transition-colors cursor-pointer h-full">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm">{ws.name}</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-0">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {ws.description && <span>{ws.description}</span>}
                    {ws.autoResponseEnabled && (
                      <span className="text-primary">auto-response on</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {company.workspaces.length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full py-8 text-center">
              No workspaces yet
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
