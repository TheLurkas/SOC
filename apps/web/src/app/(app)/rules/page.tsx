"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BookOpen, Plus, Pencil, Trash2, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import type { AnalysisRuleDto } from "@soc/shared";

const categoryColors: Record<string, string> = {
  general: "text-zinc-400 border-zinc-400/30",
  threat: "text-red-400 border-red-400/30",
  compliance: "text-purple-400 border-purple-400/30",
  network: "text-blue-400 border-blue-400/30",
  custom: "text-amber-400 border-amber-400/30",
};

export default function RulesPage() {
  const { data: session } = authClient.useSession();
  const isAdmin = (session?.user as any)?.role === "admin";

  const [rules, setRules] = useState<AnalysisRuleDto[]>([]);
  const [loading, setLoading] = useState(true);

  // dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AnalysisRuleDto | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("general");
  const [saving, setSaving] = useState(false);

  const fetchRules = useCallback(async () => {
    try {
      const { data: json } = await api.get("/rules");
      setRules(json.data);
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const openCreate = () => {
    setEditingRule(null);
    setTitle("");
    setContent("");
    setCategory("general");
    setDialogOpen(true);
  };

  const openEdit = (rule: AnalysisRuleDto) => {
    setEditingRule(rule);
    setTitle(rule.title);
    setContent(rule.content);
    setCategory(rule.category);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      if (editingRule) {
        const { data: json } = await api.patch(`/rules/${editingRule.id}`, {
          title: title.trim(),
          content: content.trim(),
          category,
        });
        setRules((prev) => prev.map((r) => (r.id === editingRule.id ? json.data : r)));
        toast.success("Rule updated");
      } else {
        const { data: json } = await api.post("/rules", {
          title: title.trim(),
          content: content.trim(),
          category,
        });
        setRules((prev) => [json.data, ...prev]);
        toast.success("Rule created");
      }
      setDialogOpen(false);
    } catch {
      // handled by interceptor
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (rule: AnalysisRuleDto) => {
    try {
      const { data: json } = await api.patch(`/rules/${rule.id}`, {
        enabled: !rule.enabled,
      });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? json.data : r)));
      toast.success(json.data.enabled ? "Rule enabled" : "Rule disabled");
    } catch {
      // handled by interceptor
    }
  };

  const deleteRule = async (id: string) => {
    try {
      await api.delete(`/rules/${id}`);
      setRules((prev) => prev.filter((r) => r.id !== id));
      toast.success("Rule deleted");
    } catch {
      // handled by interceptor
    }
  };

  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <BookOpen className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Analysis Rules</h1>
        <span className="text-xs text-muted-foreground">
          {enabledCount} active / {rules.length} total
        </span>
        {isAdmin && (
          <Button size="sm" variant="outline" className="ml-auto h-8 text-xs" onClick={openCreate}>
            <Plus className="size-3 mr-1.5" />
            Add Rule
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
        Define natural language rules that guide the AI analyst when evaluating logs and threats.
        These rules are included as additional context in the analysis prompt — they inform the AI's
        reasoning but don't override its judgment.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
      ) : rules.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <p className="text-sm text-muted-foreground">No analysis rules defined yet</p>
          {isAdmin && (
            <Button size="sm" variant="outline" className="text-xs" onClick={openCreate}>
              <Plus className="size-3 mr-1.5" />
              Create your first rule
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <Card
              key={rule.id}
              className={`transition-opacity ${!rule.enabled ? "opacity-50" : ""}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="text-sm font-medium">{rule.title}</p>
                      <Badge variant="outline" className={`text-[10px] ${categoryColors[rule.category] || ""}`}>
                        {rule.category}
                      </Badge>
                      {!rule.enabled && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground border-muted-foreground/30">
                          disabled
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                      {rule.content}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 mt-2">
                      by {rule.createdBy.name} · {new Date(rule.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleEnabled(rule)}
                        className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                        title={rule.enabled ? "Disable" : "Enable"}
                      >
                        {rule.enabled ? <Power className="size-3.5" /> : <PowerOff className="size-3.5" />}
                      </button>
                      <button
                        onClick={() => openEdit(rule)}
                        className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => deleteRule(rule.id)}
                        className="p-1.5 rounded text-muted-foreground hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* create/edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">
              {editingRule ? "Edit Rule" : "New Analysis Rule"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Title</label>
              <Input
                placeholder="e.g. Flag repeated failed logins"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="threat">Threat Detection</SelectItem>
                  <SelectItem value="compliance">Compliance</SelectItem>
                  <SelectItem value="network">Network</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">
                Rule (natural language)
              </label>
              <textarea
                className="w-full min-h-[120px] px-3 py-2 text-sm rounded-md border border-border bg-transparent placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                placeholder="Describe the rule in plain English. For example: 'More than 5 failed login attempts from the same IP within 10 minutes should be flagged as a potential brute force attack.'"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!title.trim() || !content.trim() || saving}
              >
                {saving ? "Saving..." : editingRule ? "Save Changes" : "Create Rule"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
