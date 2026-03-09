"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import api from "@/lib/api";
import type { MessageDto } from "@soc/shared";

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

function ContextBar({ text }: { text: string }) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const check = () => setIsTruncated(el.scrollWidth > el.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div className="px-3 pb-2 relative group/ctx">
      <p ref={textRef} className="text-[11px] text-muted-foreground truncate">
        {text}
      </p>
      {isTruncated && (
        <div className="absolute bottom-full left-3 right-3 mb-1 hidden group-hover/ctx:block">
          <div className="bg-popover text-popover-foreground border border-border rounded-md px-2.5 py-1.5 text-[11px] shadow-md">
            {text}
          </div>
        </div>
      )}
    </div>
  );
}

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  width: number;
  onResizeStart: () => void;
}

export function ChatPanel({ open, onClose, width, onResizeStart }: ChatPanelProps) {
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const contextLine = useContextLine();
  const { companyId, workspaceId } = usePageContext();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isThinking) return;

    const userMsg: MessageDto = {
      id: Date.now().toString(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsThinking(true);

    try {
      const { data: json } = await api.post("/chat", {
        message: text,
        companyId,
        workspaceId,
        history: messages.slice(-10),
      });

      const reply: MessageDto = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: json.data.reply,
      };
      setMessages((prev) => [...prev, reply]);
    } catch (err: any) {
      const errMsg = err?.response?.data?.message || "Failed to get response. Check your API key and try again.";
      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: "assistant", content: errMsg },
      ]);
    } finally {
      setIsThinking(false);
    }
  }, [input, isThinking, companyId, workspaceId, messages]);

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
      <div className="flex items-center justify-between px-4 h-10 border-b border-border shrink-0">
        <span className="text-sm font-medium">Lurka</span>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isThinking && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">Ask me about your logs</p>
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
              {msg.content}
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

      <div className="border-t border-border shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2 p-3 pb-2"
        >
          <Input
            placeholder="Ask about logs, alerts..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="h-8 text-sm"
          />
          <Button type="submit" size="icon" className="size-8 shrink-0" disabled={isThinking}>
            <Send className="size-3.5" />
          </Button>
        </form>
        <ContextBar text={contextLine} />
      </div>
    </div>
  );
}
