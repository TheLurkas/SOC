import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  WS_EVENTS,
  type WsLogsIngestedPayload,
  type WsLogUpdatedPayload,
  type WsLogDeletedPayload,
  type WsLogsClearedPayload,
  type WsAlertPayload,
  type WsNotificationPayload,
} from '@soc/shared';

@WebSocketGateway({
  cors: { origin: ['http://localhost:3000'], credentials: true },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log(`ws client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`ws client disconnected: ${client.id}`);
  }

  @SubscribeMessage(WS_EVENTS.JOIN_WORKSPACE)
  handleJoinWorkspace(client: Socket, workspaceId: string) {
    client.join(`workspace:${workspaceId}`);
  }

  @SubscribeMessage(WS_EVENTS.LEAVE_WORKSPACE)
  handleLeaveWorkspace(client: Socket, workspaceId: string) {
    client.leave(`workspace:${workspaceId}`);
  }

  @SubscribeMessage(WS_EVENTS.JOIN_USER)
  handleJoinUser(client: Socket, userId: string) {
    client.join(`user:${userId}`);
  }

  emitLogsIngested(payload: WsLogsIngestedPayload) {
    this.server.to(`workspace:${payload.workspaceId}`).emit(WS_EVENTS.LOGS_INGESTED, payload);
    this.server.emit(WS_EVENTS.LOGS_INGESTED, payload);
  }

  emitLogUpdated(payload: WsLogUpdatedPayload) {
    this.server.to(`workspace:${payload.workspaceId}`).emit(WS_EVENTS.LOG_UPDATED, payload);
  }

  emitLogDeleted(payload: WsLogDeletedPayload) {
    this.server.to(`workspace:${payload.workspaceId}`).emit(WS_EVENTS.LOG_DELETED, payload);
  }

  emitLogsCleared(payload: WsLogsClearedPayload) {
    this.server.to(`workspace:${payload.workspaceId}`).emit(WS_EVENTS.LOGS_CLEARED, payload);
    this.server.emit(WS_EVENTS.LOGS_CLEARED, payload);
  }

  emitAlertCreated(payload: WsAlertPayload) {
    this.server.to(`workspace:${payload.workspaceId}`).emit(WS_EVENTS.ALERT_CREATED, payload);
    this.server.emit(WS_EVENTS.ALERT_CREATED, payload);
  }

  emitAlertUpdated(payload: WsAlertPayload) {
    this.server.to(`workspace:${payload.workspaceId}`).emit(WS_EVENTS.ALERT_UPDATED, payload);
    this.server.emit(WS_EVENTS.ALERT_UPDATED, payload);
  }

  emitNotification(payload: WsNotificationPayload) {
    this.server.to(`user:${payload.userId}`).emit(WS_EVENTS.NOTIFICATION_NEW, payload.notification);
  }
}
