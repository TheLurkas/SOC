"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import type { CompanyDto, CompanyDetailDto, WorkspaceDto, GenerateReportDto } from "@soc/shared";
import { generateReportPdf } from "@/lib/report-pdf";

interface GenerateReportDialogProps {
  companies: CompanyDto[];
}

interface CompanySelection {
  checked: boolean;
  expanded: boolean;
  workspaces: WorkspaceDto[];
  selectedWsIds: Set<string>;
  loaded: boolean;
}

export function GenerateReportDialog({ companies }: GenerateReportDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selections, setSelections] = useState<Record<string, CompanySelection>>({});

  const today = new Date().toISOString().split("T")[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const [periodFrom, setPeriodFrom] = useState(weekAgo);
  const [periodTo, setPeriodTo] = useState(today);

  const toggleCompany = useCallback(async (companyId: string) => {
    setSelections((prev) => {
      const existing = prev[companyId];
      if (existing?.checked) {
        // uncheck
        return { ...prev, [companyId]: { ...existing, checked: false } };
      }

      // check — need to load workspaces if not loaded
      if (existing?.loaded) {
        return { ...prev, [companyId]: { ...existing, checked: true } };
      }

      return {
        ...prev,
        [companyId]: {
          checked: true,
          expanded: true,
          workspaces: [],
          selectedWsIds: new Set(),
          loaded: false,
        },
      };
    });

    // fetch workspaces if not loaded
    const existing = selections[companyId];
    if (!existing?.loaded) {
      try {
        const { data: json } = await api.get(`/companies/${companyId}`);
        const detail = json.data as CompanyDetailDto;
        setSelections((prev) => ({
          ...prev,
          [companyId]: {
            ...prev[companyId],
            workspaces: detail.workspaces,
            selectedWsIds: new Set(detail.workspaces.map((w) => w.id)),
            loaded: true,
          },
        }));
      } catch {
        toast.error("Failed to load workspaces");
      }
    }
  }, [selections]);

  const toggleExpand = (companyId: string) => {
    setSelections((prev) => ({
      ...prev,
      [companyId]: { ...prev[companyId], expanded: !prev[companyId]?.expanded },
    }));
  };

  const toggleWorkspace = (companyId: string, wsId: string) => {
    setSelections((prev) => {
      const sel = prev[companyId];
      if (!sel) return prev;
      const newSet = new Set(sel.selectedWsIds);
      if (newSet.has(wsId)) newSet.delete(wsId);
      else newSet.add(wsId);
      return { ...prev, [companyId]: { ...sel, selectedWsIds: newSet } };
    });
  };

  const selectedCount = Object.values(selections).filter((s) => s.checked).length;

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const payload: GenerateReportDto = {
        companies: Object.entries(selections)
          .filter(([, s]) => s.checked)
          .map(([id, s]) => ({
            id,
            workspaceIds: s.loaded && s.selectedWsIds.size < s.workspaces.length
              ? Array.from(s.selectedWsIds)
              : undefined,
          })),
        periodFrom: new Date(periodFrom).toISOString(),
        periodTo: new Date(periodTo + "T23:59:59").toISOString(),
      };

      const { data: json } = await api.post("/reports/generate", payload, { timeout: 120000 });
      await generateReportPdf(json.data);
      toast.success("Report downloaded");
      setOpen(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to generate report");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5">
            <FileText className="size-3.5" />
            Generate Report
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate Security Report</DialogTitle>
          <DialogDescription>
            Select companies and workspaces to analyze.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* period */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* company list */}
          <div className="space-y-1">
            <Label className="text-xs">Companies</Label>
            <div className="border border-border rounded-md max-h-60 overflow-y-auto">
              {companies.map((company) => {
                const sel = selections[company.id];
                const isChecked = sel?.checked ?? false;
                const isExpanded = sel?.expanded ?? false;

                return (
                  <div key={company.id} className="border-b border-border last:border-0">
                    <div className="flex items-center gap-2 px-3 py-2 hover:bg-secondary/20">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleCompany(company.id)}
                        className="size-3.5 rounded border-border accent-sky-500"
                      />
                      <button
                        onClick={() => {
                          if (isChecked) toggleExpand(company.id);
                        }}
                        className="flex items-center gap-1 flex-1 text-left"
                        disabled={!isChecked}
                      >
                        {isChecked ? (
                          isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />
                        ) : (
                          <span className="w-3" />
                        )}
                        <span className="text-xs font-medium">{company.name}</span>
                      </button>
                      <span className="text-[10px] text-muted-foreground">
                        {company.workspaces} ws
                      </span>
                    </div>

                    {isChecked && isExpanded && sel?.loaded && (
                      <div className="pl-10 pb-2 space-y-1">
                        {sel.workspaces.map((ws) => (
                          <label key={ws.id} className="flex items-center gap-2 px-2 py-0.5 cursor-pointer hover:bg-secondary/10 rounded">
                            <input
                              type="checkbox"
                              checked={sel.selectedWsIds.has(ws.id)}
                              onChange={() => toggleWorkspace(company.id, ws.id)}
                              className="size-3 rounded border-border accent-sky-500"
                            />
                            <span className="text-xs text-muted-foreground">{ws.name}</span>
                          </label>
                        ))}
                      </div>
                    )}

                    {isChecked && isExpanded && !sel?.loaded && (
                      <div className="pl-10 pb-2">
                        <span className="text-[10px] text-muted-foreground">Loading workspaces...</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={loading || selectedCount === 0}
          >
            {loading ? (
              <>
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
                Generating...
              </>
            ) : (
              `Generate Report (${selectedCount})`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
