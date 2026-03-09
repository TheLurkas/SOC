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
}
