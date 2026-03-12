import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { WS_EVENTS, type NotificationDto } from "@soc/shared";

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
  onAlertCreated?: (payload: { alertId: string; workspaceId: string }) => void;
  onAlertUpdated?: (payload: { alertId: string; workspaceId: string }) => void;
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
  handlers: Pick<SocketHandlers, "onLogsIngested" | "onLogsCleared" | "onAlertCreated" | "onAlertUpdated">,
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const s = getSocket();

    const onIngested = (p: any) => handlersRef.current.onLogsIngested?.(p);
    const onCleared = (p: any) => handlersRef.current.onLogsCleared?.(p);
    const onAlertCreated = (p: any) => handlersRef.current.onAlertCreated?.(p);
    const onAlertUpdated = (p: any) => handlersRef.current.onAlertUpdated?.(p);

    s.on(WS_EVENTS.LOGS_INGESTED, onIngested);
    s.on(WS_EVENTS.LOGS_CLEARED, onCleared);
    s.on(WS_EVENTS.ALERT_CREATED, onAlertCreated);
    s.on(WS_EVENTS.ALERT_UPDATED, onAlertUpdated);

    return () => {
      s.off(WS_EVENTS.LOGS_INGESTED, onIngested);
      s.off(WS_EVENTS.LOGS_CLEARED, onCleared);
      s.off(WS_EVENTS.ALERT_CREATED, onAlertCreated);
      s.off(WS_EVENTS.ALERT_UPDATED, onAlertUpdated);
    };
  }, []);
}

// joins the user's personal room for notifications
export function useNotificationSocket(
  userId: string | undefined,
  onNotification: (notification: NotificationDto) => void,
) {
  const handlerRef = useRef(onNotification);
  handlerRef.current = onNotification;

  useEffect(() => {
    if (!userId) return;

    const s = getSocket();
    s.emit(WS_EVENTS.JOIN_USER, userId);

    const handler = (p: any) => handlerRef.current(p);
    s.on(WS_EVENTS.NOTIFICATION_NEW, handler);

    return () => {
      s.off(WS_EVENTS.NOTIFICATION_NEW, handler);
    };
  }, [userId]);
}
