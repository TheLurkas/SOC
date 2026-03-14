"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Shield, ChevronLeft, ChevronRight, UserCheck, Clock, Activity, Send, Pencil, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useGlobalSocket } from "@/lib/socket";
import { authClient } from "@/lib/auth-client";
import type { AlertDto, AlertStatsDto, AlertActivityDto, AlertNoteDto, UserDto, PaginationMeta } from "@soc/shared";

const severityColors: Record<string, string> = {
  critical: "text-red-400 border-red-400/30 bg-red-400/10",
  high: "text-orange-400 border-orange-400/30 bg-orange-400/10",
  medium: "text-yellow-400 border-yellow-400/30 bg-yellow-400/10",
  low: "text-blue-400 border-blue-400/30 bg-blue-400/10",
};

const statusColors: Record<string, string> = {
  open: "text-red-400 border-red-400/30",
  acknowledged: "text-yellow-400 border-yellow-400/30",
  investigating: "text-blue-400 border-blue-400/30",
  resolved: "text-green-400 border-green-400/30",
};

const actionLabels: Record<string, string> = {
  assigned: "Assigned to",
  unassigned: "Unassigned from",
  status_changed: "Status changed",
  note_added: "Note added",
};

// how long an open alert can sit before it's flagged as overdue (minutes)
const OVERDUE_THRESHOLDS: Record<string, number> = {
  critical: 15,
  high: 60,
  medium: 240,
  low: 1440,
};

function isOverdue(alert: AlertDto): boolean {
  if (alert.status !== "open") return false;
  const threshold = OVERDUE_THRESHOLDS[alert.severity];
  if (!threshold) return false;
  const ageMs = Date.now() - new Date(alert.createdAt).getTime();
  return ageMs > threshold * 60 * 1000;
}

type PageTab = "alerts" | "activity";
type ViewTab = "all" | "unassigned" | "mine";

export default function AlertsPage() {
  const { data: session } = authClient.useSession();
  const isAdmin = (session?.user as any)?.role === "admin";
  const currentUserId = session?.user?.id;

  const [pageTab, setPageTab] = useState<PageTab>("alerts");

  // ── alert state ──
  const [alerts, setAlerts] = useState<AlertDto[]>([]);
  const [stats, setStats] = useState<AlertStatsDto | null>(null);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState<AlertDto | null>(null);
  const [notes, setNotes] = useState<AlertNoteDto[]>([]);
  const [noteText, setNoteText] = useState("");
  const [noteSending, setNoteSending] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");

  // alert filters
  const [viewTab, setViewTab] = useState<ViewTab>(isAdmin ? "unassigned" : "mine");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [timeFilter, setTimeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  // ── activity state (admin only) ──
  const [activities, setActivities] = useState<AlertActivityDto[]>([]);
  const [actMeta, setActMeta] = useState<PaginationMeta | null>(null);
  const [actLoading, setActLoading] = useState(true);
  const [actPage, setActPage] = useState(1);
  const [actActionFilter, setActActionFilter] = useState<string>("all");
  const [actUserFilter, setActUserFilter] = useState<string>("all");
  const [actTimeFilter, setActTimeFilter] = useState<string>("all");

  const getTimeRange = (filter: string): { from?: string } => {
    if (filter === "all") return {};
    const now = new Date();
    const from = new Date();
    switch (filter) {
      case "1h": from.setHours(now.getHours() - 1); break;
      case "6h": from.setHours(now.getHours() - 6); break;
      case "24h": from.setHours(now.getHours() - 24); break;
      case "7d": from.setDate(now.getDate() - 7); break;
      case "30d": from.setDate(now.getDate() - 30); break;
      default: return {};
    }
    return { from: from.toISOString() };
  };

  const fetchAlerts = useCallback(async () => {
    try {
      const params: Record<string, string> = { page: String(page), limit: "20" };
      if (statusFilter !== "all") params.status = statusFilter;
      if (severityFilter !== "all") params.severity = severityFilter;
      if (viewTab === "mine" && currentUserId) params.assigneeId = currentUserId;
      if (viewTab === "unassigned") params.unassigned = "true";
      const { from } = getTimeRange(timeFilter);
      if (from) params.from = from;

      const { data: json } = await api.get("/alerts", { params });
      setAlerts(json.data);
      setMeta(json.meta);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, severityFilter, viewTab, currentUserId, timeFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const { data: json } = await api.get("/alerts/stats");
      setStats(json.data);
    } catch {
      // ignore
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const { data: json } = await api.get("/users");
      setUsers(json.data);
    } catch {
      // ignore
    }
  }, [isAdmin]);

  const fetchActivity = useCallback(async () => {
    if (!isAdmin) return;
    setActLoading(true);
    try {
      const params: Record<string, string> = { page: String(actPage), limit: "30" };
      if (actActionFilter !== "all") params.action = actActionFilter;
      if (actUserFilter !== "all") params.userId = actUserFilter;
      const { from } = getTimeRange(actTimeFilter);
      if (from) params.from = from;

      const { data: json } = await api.get("/alerts/activity", { params });
      setActivities(json.data);
      setActMeta(json.meta);
    } catch {
      // ignore
    } finally {
      setActLoading(false);
    }
  }, [isAdmin, actPage, actActionFilter, actUserFilter, actTimeFilter]);

  useEffect(() => {
    fetchAlerts();
    fetchStats();
    fetchUsers();
  }, [fetchAlerts, fetchStats, fetchUsers]);

  useEffect(() => {
    if (pageTab === "activity") fetchActivity();
  }, [pageTab, fetchActivity]);

  const fetchNotes = async (alertId: string) => {
    try {
      const { data: json } = await api.get(`/alerts/${alertId}/notes`);
      setNotes(json.data);
    } catch {
      // ignore
    }
  };

  // load notes when an alert is selected
  useEffect(() => {
    if (selectedAlert) {
      setNotes([]);
      setNoteText("");
      fetchNotes(selectedAlert.id);
    }
  }, [selectedAlert?.id]);

  // real-time alert updates
  useGlobalSocket({
    onAlertCreated: () => {
      fetchAlerts();
      fetchStats();
      toast.info("New alert received");
    },
    onAlertUpdated: () => {
      fetchAlerts();
      fetchStats();
    },
  });

  const updateAlert = async (id: string, data: { status?: string; assigneeId?: string | null }) => {
    try {
      const { data: json } = await api.patch(`/alerts/${id}`, data);
      setAlerts((prev) => prev.map((a) => (a.id === id ? json.data : a)));
      if (selectedAlert?.id === id) setSelectedAlert(json.data);
      fetchStats();
      if (data.status) toast.success(`Status changed to ${data.status}`);
      else if (data.assigneeId === null) toast.success("Alert unassigned");
      else if (data.assigneeId) toast.success("Alert assigned");
    } catch {
      // handled by interceptor
    }
  };

  const addNote = async () => {
    if (!selectedAlert || !noteText.trim()) return;
    setNoteSending(true);
    try {
      const { data: json } = await api.post(`/alerts/${selectedAlert.id}/notes`, {
        content: noteText.trim(),
      });
      setNotes((prev) => [...prev, json.data]);
      setNoteText("");
    } catch {
      // handled by interceptor
    } finally {
      setNoteSending(false);
    }
  };

  const editNote = async (noteId: string) => {
    if (!selectedAlert || !editingNoteText.trim()) return;
    try {
      const { data: json } = await api.patch(`/alerts/${selectedAlert.id}/notes/${noteId}`, {
        content: editingNoteText.trim(),
      });
      setNotes((prev) => prev.map((n) => (n.id === noteId ? json.data : n)));
      setEditingNoteId(null);
      setEditingNoteText("");
      toast.success("Note updated");
    } catch {
      // handled by interceptor
    }
  };

  const deleteNote = async (noteId: string) => {
    if (!selectedAlert) return;
    try {
      await api.delete(`/alerts/${selectedAlert.id}/notes/${noteId}`);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success("Note deleted");
    } catch {
      // handled by interceptor
    }
  };

  const statCards = stats
    ? [
        { label: "Total", value: stats.total },
        { label: "Open", value: stats.open, color: "text-red-400" },
        { label: "Acknowledged", value: stats.acknowledged, color: "text-yellow-400" },
        { label: "Investigating", value: stats.investigating, color: "text-blue-400" },
        { label: "Resolved", value: stats.resolved, color: "text-green-400" },
      ]
    : [];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <Shield className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Alerts</h1>

        {isAdmin && (
          <div className="flex items-center border border-border rounded-lg overflow-hidden ml-4">
            <button
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                pageTab === "alerts"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setPageTab("alerts")}
            >
              Alerts
            </button>
            <button
              className={`px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                pageTab === "activity"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setPageTab("activity")}
            >
              <Activity className="size-3" />
              Activity Log
            </button>
          </div>
        )}
      </div>

      {pageTab === "alerts" ? (
        <>
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {statCards.map((s) => (
                <Card key={s.label}>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className={`text-2xl font-semibold font-mono mt-1 ${s.color || ""}`}>
                      {s.value}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center border border-border rounded-lg overflow-hidden">
              {(["all", "unassigned", "mine"] as const).map((tab) => (
                <button
                  key={tab}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                    viewTab === tab
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => { setViewTab(tab); setPage(1); }}
                >
                  {tab === "mine" && <UserCheck className="size-3" />}
                  {tab === "all" ? "All" : tab === "unassigned" ? "Unassigned" : "My Alerts"}
                </button>
              ))}
            </div>

            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40 h-8 text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="investigating">Investigating</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>

            <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40 h-8 text-sm">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>

            <Select value={timeFilter} onValueChange={(v) => { setTimeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36 h-8 text-sm">
                <Clock className="size-3 mr-1 text-muted-foreground" />
                <SelectValue placeholder="Time range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="1h">Last hour</SelectItem>
                <SelectItem value="6h">Last 6 hours</SelectItem>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>

            {meta && (
              <span className="text-xs text-muted-foreground ml-auto">
                {meta.total} alert{meta.total !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
          ) : alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No alerts found</p>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Severity</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Alert</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Workspace</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Assigned To</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((alert) => {
                    const overdue = isOverdue(alert);
                    return (
                    <tr
                      key={alert.id}
                      className={`border-b border-border last:border-0 hover:bg-secondary/10 transition-colors cursor-pointer ${
                        overdue
                          ? "bg-red-500/10 border-l-2 border-l-red-500"
                          : alert.assigneeId === currentUserId
                          ? "bg-secondary/5 border-l-2 border-l-blue-400/50"
                          : ""
                      }`}
                      onClick={() => setSelectedAlert(alert)}
                    >
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={severityColors[alert.severity] || ""}>
                          {alert.severity}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="max-w-xs">
                          <p className="font-medium truncate">{alert.title}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {alert.sourceIp && `${alert.sourceIp} → ${alert.destinationIp}`}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div>
                          <p className="text-xs">{alert.workspace.company.name}</p>
                          <p className="text-xs text-muted-foreground">{alert.workspace.name}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={statusColors[alert.status] || ""}>
                          {alert.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {alert.assignee?.name || (
                          <span className="text-muted-foreground/50">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {new Date(alert.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {meta && meta.pages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground">
                {page} / {meta.pages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= meta.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          )}
        </>
      ) : (
        /* ── Activity Log tab (admin only) ── */
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={actActionFilter} onValueChange={(v) => { setActActionFilter(v); setActPage(1); }}>
              <SelectTrigger className="w-44 h-8 text-sm">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                <SelectItem value="status_changed">Status changed</SelectItem>
                <SelectItem value="note_added">Note added</SelectItem>
              </SelectContent>
            </Select>

            <Select value={actUserFilter} onValueChange={(v) => { setActUserFilter(v); setActPage(1); }}>
              <SelectTrigger className="w-44 h-8 text-sm">
                <SelectValue>
                  {actUserFilter === "all"
                    ? "All users"
                    : users.find((u) => u.id === actUserFilter)?.name || "User"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={actTimeFilter} onValueChange={(v) => { setActTimeFilter(v); setActPage(1); }}>
              <SelectTrigger className="w-36 h-8 text-sm">
                <Clock className="size-3 mr-1 text-muted-foreground" />
                <SelectValue placeholder="Time range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="1h">Last hour</SelectItem>
                <SelectItem value="6h">Last 6 hours</SelectItem>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>

            {actMeta && (
              <span className="text-xs text-muted-foreground ml-auto">
                {actMeta.total} entr{actMeta.total !== 1 ? "ies" : "y"}
              </span>
            )}
          </div>

          {actLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
          ) : activities.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No activity yet</p>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Time</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">User</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Action</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Detail</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Alert</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Workspace</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((act) => (
                    <tr key={act.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(act.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium">
                        {act.user.name}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={
                            act.action === "assigned"
                              ? "text-blue-400 border-blue-400/30"
                              : act.action === "unassigned"
                              ? "text-orange-400 border-orange-400/30"
                              : "text-yellow-400 border-yellow-400/30"
                          }
                        >
                          {actionLabels[act.action] || act.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {act.detail}
                      </td>
                      <td className="px-4 py-3">
                        <div className="max-w-xs">
                          <p className="text-xs font-medium truncate">{act.alert.title}</p>
                          <Badge variant="outline" className={`text-[10px] mt-0.5 ${severityColors[act.alert.severity] || ""}`}>
                            {act.alert.severity}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <p className="text-xs">{act.alert.workspace.company.name}</p>
                        <p className="text-xs text-muted-foreground">{act.alert.workspace.name}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {actMeta && actMeta.pages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={actPage <= 1}
                onClick={() => setActPage((p) => p - 1)}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground">
                {actPage} / {actMeta.pages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={actPage >= actMeta.pages}
                onClick={() => setActPage((p) => p + 1)}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          )}
        </>
      )}

      {/* alert detail dialog */}
      <Dialog open={!!selectedAlert} onOpenChange={(open) => { if (!open) setSelectedAlert(null); }}>
        <DialogContent className="max-w-lg">
          {selectedAlert && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className={severityColors[selectedAlert.severity] || ""}>
                    {selectedAlert.severity}
                  </Badge>
                  <Badge variant="outline" className={statusColors[selectedAlert.status] || ""}>
                    {selectedAlert.status}
                  </Badge>
                </div>
                <DialogTitle className="text-base">{selectedAlert.title}</DialogTitle>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <p className="text-muted-foreground">{selectedAlert.description}</p>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground mb-1">Company</p>
                    <p>{selectedAlert.workspace.company.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Workspace</p>
                    <p>{selectedAlert.workspace.name}</p>
                  </div>
                  {selectedAlert.sourceIp && (
                    <div>
                      <p className="text-muted-foreground mb-1">Source IP</p>
                      <p className="font-mono">{selectedAlert.sourceIp}</p>
                    </div>
                  )}
                  {selectedAlert.destinationIp && (
                    <div>
                      <p className="text-muted-foreground mb-1">Destination IP</p>
                      <p className="font-mono">{selectedAlert.destinationIp}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-muted-foreground mb-1">Related Logs</p>
                    <p>{selectedAlert.logCount}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Created</p>
                    <p>{new Date(selectedAlert.createdAt).toLocaleString()}</p>
                  </div>
                </div>

                <div className="border-t border-border pt-4 space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1.5">Status</label>
                    <Select
                      value={selectedAlert.status}
                      onValueChange={(v) => updateAlert(selectedAlert.id, { status: v })}
                    >
                      <SelectTrigger className="h-8 text-sm w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="acknowledged">Acknowledged</SelectItem>
                        <SelectItem value="investigating">Investigating</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground block mb-1.5">Assign To</label>
                    {isAdmin ? (
                      <Select
                        value={selectedAlert.assigneeId || "unassigned"}
                        onValueChange={(v) =>
                          updateAlert(selectedAlert.id, {
                            assigneeId: v === "unassigned" ? null : v,
                          })
                        }
                      >
                        <SelectTrigger className="h-8 text-sm w-full">
                          <SelectValue>
                            {selectedAlert.assignee?.name || "Unassigned"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {users.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} ({u.role})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="flex items-center gap-2">
                        {selectedAlert.assigneeId === currentUserId ? (
                          <>
                            <span className="text-sm flex-1">You</span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              onClick={() => updateAlert(selectedAlert.id, { assigneeId: null })}
                            >
                              Unassign
                            </Button>
                          </>
                        ) : (
                          <>
                            <span className="text-sm flex-1 text-muted-foreground">
                              {selectedAlert.assignee?.name || "Unassigned"}
                            </span>
                            {!selectedAlert.assigneeId && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs"
                                onClick={() => updateAlert(selectedAlert.id, { assigneeId: currentUserId! })}
                              >
                                <UserCheck className="size-3 mr-1" />
                                Assign to me
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* investigation notes */}
                <div className="border-t border-border pt-4">
                  <label className="text-xs text-muted-foreground block mb-2">
                    Investigation Notes ({notes.length})
                  </label>

                  {notes.length > 0 && (
                    <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
                      {notes.map((note) => {
                        const canModify = note.user.id === currentUserId || isAdmin;
                        const isEditing = editingNoteId === note.id;

                        return (
                          <div key={note.id} className="bg-secondary/20 rounded-md px-3 py-2 group">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium">{note.user.name}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {new Date(note.createdAt).toLocaleString()}
                              </span>
                              {canModify && !isEditing && (
                                <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    className="text-muted-foreground hover:text-foreground p-0.5"
                                    onClick={() => { setEditingNoteId(note.id); setEditingNoteText(note.content); }}
                                  >
                                    <Pencil className="size-3" />
                                  </button>
                                  <button
                                    className="text-muted-foreground hover:text-red-400 p-0.5"
                                    onClick={() => deleteNote(note.id)}
                                  >
                                    <Trash2 className="size-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                            {isEditing ? (
                              <div className="flex gap-1.5 mt-1">
                                <input
                                  type="text"
                                  className="flex-1 h-7 px-2 text-xs rounded border border-border bg-transparent focus:outline-none focus:ring-1 focus:ring-ring"
                                  value={editingNoteText}
                                  onChange={(e) => setEditingNoteText(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") editNote(note.id); if (e.key === "Escape") setEditingNoteId(null); }}
                                  autoFocus
                                />
                                <button
                                  className="text-muted-foreground hover:text-green-400 p-0.5"
                                  onClick={() => editNote(note.id)}
                                >
                                  <Check className="size-3.5" />
                                </button>
                                <button
                                  className="text-muted-foreground hover:text-foreground p-0.5"
                                  onClick={() => setEditingNoteId(null)}
                                >
                                  <X className="size-3.5" />
                                </button>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{note.content}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 h-8 px-3 text-xs rounded-md border border-border bg-transparent placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder="Add a note..."
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addNote(); } }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2"
                      disabled={!noteText.trim() || noteSending}
                      onClick={addNote}
                    >
                      <Send className="size-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
