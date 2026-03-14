"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { X, Send, Plus, Trash2, MessageSquare, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import api from "@/lib/api";
import type { MessageDto, ConversationDto, ChatMention, MentionSuggestionDto } from "@soc/shared";

function usePageContext() {
  const pathname = usePathname();

  const wsMatch = pathname.match(/^\/companies\/([^/]+)\/workspaces\/([^/]+)/);
  if (wsMatch) return { companyId: wsMatch[1], workspaceId: wsMatch[2] };

  const companyMatch = pathname.match(/^\/companies\/([^/]+)/);
  if (companyMatch) return { companyId: companyMatch[1], workspaceId: undefined };

  return { companyId: undefined, workspaceId: undefined };
}

function useContextLine() {
  const pathname = usePathname();
  const { companyId, workspaceId } = usePageContext();
  const [label, setLabel] = useState("Monitoring all companies");

  useEffect(() => {
    if (workspaceId && companyId) {
      api.get(`/companies/${companyId}/workspaces/${workspaceId}`)
        .then(({ data: json }) => {
          const ws = json.data;
          setLabel(`Scoped to ${ws.name} · ${ws.company?.name || companyId}`);
        })
        .catch(() => setLabel(`Scoped to workspace ${workspaceId.slice(0, 8)}...`));
    } else if (companyId) {
      api.get(`/companies/${companyId}`)
        .then(({ data: json }) => setLabel(`Scoped to ${json.data.name}`))
        .catch(() => setLabel(`Scoped to company ${companyId.slice(0, 8)}...`));
    } else if (pathname === "/alerts") {
      setLabel("Monitoring alerts across all companies");
    } else {
      setLabel("Monitoring all companies");
    }
  }, [pathname, companyId, workspaceId]);

  return label;
}

// highlights @mentions by matching against known entity names
function renderWithMentions(text: string, isUser: boolean, knownNames: string[]) {
  if (!knownNames.length) return text;

  const parts: (string | React.ReactNode)[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    let earliestIdx = -1;
    let earliestName = "";

    for (const name of knownNames) {
      const idx = remaining.indexOf(`@${name}`);
      if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
        earliestIdx = idx;
        earliestName = name;
      }
    }

    if (earliestIdx === -1) {
      parts.push(remaining);
      break;
    }

    if (earliestIdx > 0) parts.push(remaining.slice(0, earliestIdx));

    parts.push(
      <span key={keyIdx++} className={cn(
        "rounded px-1 py-0.5 font-medium",
        isUser ? "bg-white/20 text-primary-foreground" : "bg-primary/15 text-primary"
      )}>@{earliestName}</span>
    );

    remaining = remaining.slice(earliestIdx + 1 + earliestName.length);
  }

  return parts.length > 0 ? parts : text;
}

// overlay for the textarea — no padding on spans so character widths stay identical
function renderInputWithMentions(text: string, activeMentions: ChatMention[]) {
  if (!activeMentions.length) return <span className="text-foreground">{text}</span>;

  const parts: (string | React.ReactNode)[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    let earliestIdx = -1;
    let earliestName = "";

    for (const m of activeMentions) {
      const idx = remaining.indexOf(`@${m.name}`);
      if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
        earliestIdx = idx;
        earliestName = m.name;
      }
    }

    if (earliestIdx === -1) {
      parts.push(<span key={keyIdx++} className="text-foreground">{remaining}</span>);
      break;
    }

    if (earliestIdx > 0) {
      parts.push(<span key={keyIdx++} className="text-foreground">{remaining.slice(0, earliestIdx)}</span>);
    }

    parts.push(
      <span key={keyIdx++} className="text-primary font-medium">
        @{earliestName}
      </span>
    );

    remaining = remaining.slice(earliestIdx + 1 + earliestName.length);
  }

  return parts;
}

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  width: number;
  onResizeStart: () => void;
}

export function ChatPanel({ open, onClose, width, onResizeStart }: ChatPanelProps) {
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [mentions, setMentions] = useState<ChatMention[]>([]);
  const [allEntityNames, setAllEntityNames] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<MentionSuggestionDto[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextLine = useContextLine();
  const { companyId, workspaceId } = usePageContext();

  const loadConversations = useCallback(() => {
    api.get("/chat/conversations")
      .then(({ data: json }) => setConversations(json.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadConversations();
    // fetch all company/workspace names for mention highlighting
    api.get("/chat/suggestions", { params: { q: "" } })
      .then(({ data: json }) => {
        const names = (json.data as MentionSuggestionDto[]).map((s) => s.name);
        setAllEntityNames(names);
      })
      .catch(() => {});
  }, [loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  // fetch suggestions when mention query changes
  useEffect(() => {
    if (!showSuggestions) return;
    if (suggestionsDebounce.current) clearTimeout(suggestionsDebounce.current);
    suggestionsDebounce.current = setTimeout(() => {
      const params: Record<string, string> = { q: mentionQuery };
      if (companyId) params.companyId = companyId;
      if (workspaceId) params.workspaceId = workspaceId;
      api.get("/chat/suggestions", { params })
        .then(({ data: json }) => {
          setSuggestions(json.data);
          setSelectedSuggestion(0);
        })
        .catch(() => setSuggestions([]));
    }, 150);
  }, [mentionQuery, showSuggestions, companyId, workspaceId]);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);

    // prune mentions whose @name no longer appears in the text
    const surviving = mentions.filter((m) => value.includes(`@${m.name}`));
    if (surviving.length !== mentions.length) setMentions(surviving);

    // find the last @ that isn't part of an existing mention
    let atIdx = -1;
    for (let i = value.length - 1; i >= 0; i--) {
      if (value[i] !== "@") continue;
      // check if this @ belongs to a known mention
      const isExisting = surviving.some((m) => value.startsWith(`@${m.name}`, i));
      if (!isExisting && (i === 0 || value[i - 1] === " ")) {
        atIdx = i;
        break;
      }
    }

    if (atIdx !== -1) {
      const query = value.slice(atIdx + 1);
      // allow spaces in query if it's a partial match of a known entity name
      const hasSpaces = query.includes(" ");
      const isPartialMatch = hasSpaces && allEntityNames.some((n) =>
        n.toLowerCase().startsWith(query.toLowerCase())
      );
      if (!hasSpaces || isPartialMatch) {
        setMentionQuery(query);
        setShowSuggestions(true);
        return;
      }
    }
    setShowSuggestions(false);
  }, [mentions, allEntityNames]);

  const selectSuggestion = useCallback((suggestion: MentionSuggestionDto) => {
    // replace @query with @name in input
    const atIdx = input.lastIndexOf("@");
    const before = input.slice(0, atIdx);
    setInput(`${before}@${suggestion.name} `);

    // add to mentions (avoid duplicates)
    setMentions((prev) => {
      if (prev.some((m) => m.id === suggestion.id)) return prev;
      return [...prev, { type: suggestion.type, id: suggestion.id, name: suggestion.name }];
    });

    setShowSuggestions(false);
    inputRef.current?.focus();
  }, [input]);

  const removeMention = useCallback((id: string) => {
    setMentions((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // enter sends, shift+enter adds newline
    if (e.key === "Enter" && !e.shiftKey && !showSuggestions) {
      e.preventDefault();
      handleSend();
      return;
    }

    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedSuggestion((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedSuggestion((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectSuggestion(suggestions[selectedSuggestion]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }, [showSuggestions, suggestions, selectedSuggestion, selectSuggestion]);

  const openConversation = useCallback(async (id: string) => {
    try {
      const { data: json } = await api.get(`/chat/conversations/${id}`);
      setActiveConvoId(id);
      setMessages(json.data.messages);
      setMentions([]);
      setShowSidebar(false);
    } catch {}
  }, []);

  const startNewChat = useCallback(() => {
    setActiveConvoId(null);
    setMessages([]);
    setMentions([]);
    setShowSidebar(false);
  }, []);

  const deleteConversation = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.delete(`/chat/conversations/${id}`);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConvoId === id) {
        setActiveConvoId(null);
        setMessages([]);
      }
    } catch {}
  }, [activeConvoId]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isThinking) return;

    const userMsg: MessageDto = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "32px";
    setIsThinking(true);
    setShowSuggestions(false);

    try {
      const { data: json } = await api.post("/chat/message", {
        message: text,
        conversationId: activeConvoId || undefined,
        companyId,
        workspaceId,
        mentions: mentions.length > 0 ? mentions : undefined,
      });

      const { conversationId: newConvoId, title: newTitle, message: reply } = json.data;

      if (!activeConvoId) {
        setActiveConvoId(newConvoId);
        setConversations((prev) => [
          {
            id: newConvoId,
            title: newTitle || text.slice(0, 40),
            companyId: companyId || null,
            workspaceId: workspaceId || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          ...prev,
        ]);
      } else if (newTitle) {
        setConversations((prev) =>
          prev.map((c) => c.id === newConvoId ? { ...c, title: newTitle, updatedAt: new Date().toISOString() } : c)
        );
      }

      setMessages((prev) => [...prev, reply]);
      setMentions([]);
    } catch (err: any) {
      const errMsg = err?.response?.data?.message || "Failed to get response. Check your API key and try again.";
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: "assistant", content: errMsg },
      ]);
    } finally {
      setIsThinking(false);
    }
  }, [input, isThinking, activeConvoId, companyId, workspaceId, mentions, loadConversations]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  };

  return (
    <div
      className={cn(
        "fixed top-12 right-0 h-[calc(100vh-3rem)] border-l border-border bg-background z-40 flex flex-col transition-transform duration-200",
        open ? "translate-x-0" : "translate-x-full"
      )}
      style={{ width }}
    >
      <div
        onMouseDown={onResizeStart}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-50"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={() => setShowSidebar((s) => !s)}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary/50 shrink-0"
            title="Conversation history"
          >
            <MessageSquare className="size-3.5" />
          </button>
          <span className="text-sm font-medium truncate">
            {activeConvoId
              ? conversations.find((c) => c.id === activeConvoId)?.title || "Lurka"
              : "Lurka"}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={startNewChat}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary/50"
            title="New chat"
          >
            <Plus className="size-3.5" />
          </button>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary/50"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Conversation sidebar */}
        <div
          className={cn(
            "absolute inset-0 bg-background z-10 flex flex-col transition-transform duration-150",
            showSidebar ? "translate-x-0" : "-translate-x-full pointer-events-none"
          )}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <button
              onClick={() => setShowSidebar(false)}
              className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary/50"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="text-xs font-medium text-muted-foreground">Conversations</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4 text-center">No conversations yet</p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  onClick={() => openConversation(c.id)}
                  className={cn(
                    "flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-secondary/50 border-b border-border/30 group",
                    activeConvoId === c.id && "bg-secondary/40"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{c.title}</p>
                    <p className="text-[10px] text-muted-foreground">{formatDate(c.updatedAt)}</p>
                  </div>
                  <button
                    onClick={(e) => deleteConversation(c.id, e)}
                    className="text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 p-1 shrink-0"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-border p-2">
            <button
              onClick={startNewChat}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-1.5 rounded hover:bg-secondary/50"
            >
              <Plus className="size-3" />
              New chat
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !isThinking && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">Ask me anything — logs, alerts, companies, users, rules, costs. Use @ to scope to a company or workspace.</p>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground"
                )}
              >
                {renderWithMentions(msg.content, msg.role === "user", allEntityNames)}
              </div>
            </div>
          ))}
          {isThinking && (
            <div className="flex justify-start">
              <div className="bg-secondary rounded-md px-3 py-2 flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-muted-foreground animate-pulse" />
                <span className="size-1.5 rounded-full bg-muted-foreground animate-pulse [animation-delay:150ms]" />
                <span className="size-1.5 rounded-full bg-muted-foreground animate-pulse [animation-delay:300ms]" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-border shrink-0">
        {/* Active mentions */}
        {mentions.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 pt-2">
            {mentions.map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center gap-1 bg-primary/15 text-primary text-[11px] px-1.5 py-0.5 rounded"
              >
                @{m.name}
                <button
                  onClick={() => removeMention(m.id)}
                  className="hover:text-foreground"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Suggestions dropdown */}
        <div className="relative">
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute bottom-full left-3 right-3 mb-1 bg-popover border border-border rounded-md shadow-lg overflow-hidden z-20 max-h-48 overflow-y-auto">
              {suggestions.map((s, i) => (
                <button
                  key={`${s.type}-${s.id}`}
                  onClick={() => selectSuggestion(s)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-secondary/50",
                    i === selectedSuggestion && "bg-secondary/50"
                  )}
                >
                  <span className="text-[10px] text-muted-foreground uppercase font-medium w-14 shrink-0">
                    {s.type === "company" ? "company" : "workspace"}
                  </span>
                  <span className="truncate">{s.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2 p-3 pb-2 items-end">
            <div className="relative flex-1 min-w-0">
              <textarea
                ref={inputRef}
                placeholder="Ask anything... type @ to scope"
                value={input}
                onChange={(e) => {
                  handleInputChange(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                }}
                onKeyDown={handleKeyDown}
                rows={1}
                className={cn(
                  "w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
                  mentions.length > 0 && "text-transparent caret-foreground selection:bg-primary/20"
                )}
                style={{ height: "32px", maxHeight: "120px" }}
              />
              {mentions.length > 0 && input && (
                <div
                  className="absolute inset-0 pointer-events-none px-2.5 py-1.5 text-sm whitespace-pre-wrap wrap-break-word overflow-hidden rounded-lg border border-transparent"
                  aria-hidden="true"
                >
                  {renderInputWithMentions(input, mentions)}
                </div>
              )}
            </div>
            <Button type="button" size="icon" className="size-8 shrink-0" disabled={isThinking} onClick={handleSend}>
              <Send className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="px-3 pb-2">
          <p className="text-[11px] text-muted-foreground truncate">{contextLine}</p>
        </div>
      </div>
    </div>
  );
}
