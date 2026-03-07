"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { mockCompanies, mockWorkspaces } from "@/lib/mock-data";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const mockMessages: Message[] = [
  {
    id: "1",
    role: "user",
    content: "Are there any brute force attempts on Global Finance?",
  },
  {
    id: "2",
    role: "assistant",
    content:
      "I found 47 failed SSH login attempts from 192.168.1.100 targeting the Global Finance production workspace in the last 2 hours. The attempts are targeting the root account across 3 different hosts. This pattern is consistent with a brute force attack. I recommend blocking the source IP immediately.",
  },
  {
    id: "3",
    role: "user",
    content: "What about MedSecure Health?",
  },
  {
    id: "4",
    role: "assistant",
    content:
      "MedSecure Health has 12 open alerts. The most critical are 3 unauthorized access attempts to the patient database from an external IP (203.0.113.42). There are also 5 firewall rule violations on port 3306 and 4 anomalous outbound data transfers detected in the last hour.",
  },
];

function useContextLine(): string {
  const pathname = usePathname();

  // /companies/[id]/workspaces/[wsId] — single workspace
  const wsMatch = pathname.match(/^\/companies\/([^/]+)\/workspaces\/([^/]+)/);
  if (wsMatch) {
    const company = mockCompanies.find((c) => c.id === wsMatch[1]);
    const workspace = mockWorkspaces.find((w) => w.id === wsMatch[2]);
    if (company && workspace) {
      return `Reading ${workspace.name} · ${company.name} · ${workspace.logsToday.toLocaleString()} logs today`;
    }
  }

  // /companies/[id] — company with workspaces
  const companyMatch = pathname.match(/^\/companies\/([^/]+)/);
  if (companyMatch) {
    const company = mockCompanies.find((c) => c.id === companyMatch[1]);
    if (company) {
      const ws = mockWorkspaces.filter((w) => w.companyId === company.id);
      if (ws.length === 1) {
        return `Reading ${ws[0].name} · ${company.name}`;
      }
      const totalLogs = ws.reduce((sum, w) => sum + w.logsToday, 0);
      return `Reading ${ws.length} workspaces · ${company.name} · ${totalLogs.toLocaleString()} logs`;
    }
  }

  // /alerts
  if (pathname === "/alerts") {
    const totalAlerts = mockCompanies.reduce((sum, c) => sum + c.alerts, 0);
    return `Monitoring ${totalAlerts} alerts across ${mockCompanies.length} companies`;
  }

  // / dashboard
  const totalWorkspaces = mockWorkspaces.length;
  const totalLogs = mockWorkspaces.reduce((sum, w) => sum + w.logsToday, 0);
  return `Monitoring ${mockCompanies.length} companies · ${totalWorkspaces} workspaces · ${totalLogs.toLocaleString()} logs`;
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
  const [messages, setMessages] = useState<Message[]>(mockMessages);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const contextLine = useContextLine();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const handleSend = () => {
    if (!input.trim() || isThinking) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsThinking(true);

    setTimeout(() => {
      const reply: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content:
          "Analyzing workspace logs... No immediate threats detected matching your query. I checked across all active workspaces and found normal traffic patterns. Let me know if you want me to dig deeper into a specific timeframe or source.",
      };
      setMessages((prev) => [...prev, reply]);
      setIsThinking(false);
    }, 1500);
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
        {messages.map((msg) => (
          <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-md px-3 py-2 text-sm",
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
          <Button type="submit" size="icon" className="size-8 shrink-0">
            <Send className="size-3.5" />
          </Button>
        </form>
        <ContextBar text={contextLine} />
      </div>
    </div>
  );
}
