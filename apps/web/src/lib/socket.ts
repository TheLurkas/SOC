import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { WS_EVENTS } from "@soc/shared";

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });
  }
  return socket;
}

export interface SocketHandlers {
  onLogsIngested?: (payload: { workspaceId: string; count: number }) => void;
  onLogUpdated?: (payload: { workspaceId: string; logId: string }) => void;
  onLogDeleted?: (payload: { workspaceId: string; logId: string }) => void;
  onLogsCleared?: (payload: { workspaceId: string; deleted: number }) => void;
}

// joins a workspace room and listens for scoped events
export function useWorkspaceSocket(
  workspaceId: string | undefined,
  handlers: SocketHandlers,
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!workspaceId) return;

    const s = getSocket();
    s.emit(WS_EVENTS.JOIN_WORKSPACE, workspaceId);

    const onIngested = (p: any) => handlersRef.current.onLogsIngested?.(p);
    const onUpdated = (p: any) => handlersRef.current.onLogUpdated?.(p);
    const onDeleted = (p: any) => handlersRef.current.onLogDeleted?.(p);
    const onCleared = (p: any) => handlersRef.current.onLogsCleared?.(p);

    s.on(WS_EVENTS.LOGS_INGESTED, onIngested);
    s.on(WS_EVENTS.LOG_UPDATED, onUpdated);
    s.on(WS_EVENTS.LOG_DELETED, onDeleted);
    s.on(WS_EVENTS.LOGS_CLEARED, onCleared);

    return () => {
      s.emit(WS_EVENTS.LEAVE_WORKSPACE, workspaceId);
      s.off(WS_EVENTS.LOGS_INGESTED, onIngested);
      s.off(WS_EVENTS.LOG_UPDATED, onUpdated);
      s.off(WS_EVENTS.LOG_DELETED, onDeleted);
      s.off(WS_EVENTS.LOGS_CLEARED, onCleared);
    };
  }, [workspaceId]);
}

// listens for broadcast events (not room-scoped), for dashboard/company pages
export function useGlobalSocket(
  handlers: Pick<SocketHandlers, "onLogsIngested" | "onLogsCleared">,
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const s = getSocket();

    const onIngested = (p: any) => handlersRef.current.onLogsIngested?.(p);
    const onCleared = (p: any) => handlersRef.current.onLogsCleared?.(p);

    s.on(WS_EVENTS.LOGS_INGESTED, onIngested);
    s.on(WS_EVENTS.LOGS_CLEARED, onCleared);

    return () => {
      s.off(WS_EVENTS.LOGS_INGESTED, onIngested);
      s.off(WS_EVENTS.LOGS_CLEARED, onCleared);
    };
  }, []);
}
