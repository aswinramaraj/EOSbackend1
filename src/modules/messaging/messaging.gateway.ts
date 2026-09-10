import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import {
  MessagingService,
  STUDENT_TO_STUDENT_BLOCKED,
} from './messaging.service';
import type { MessagingPusher } from './messaging-pusher.interface';
import { PresenceService } from './presence.service';
import { MessagingRateLimiterService } from './messaging-rate-limiter.service';

interface AuthedSocket extends Socket {
  data: { user?: JwtPayload };
}

// Mirrors main.ts's app.enableCors() origin list exactly — Express's CORS
// config doesn't extend to this Socket.IO transport, so it needs its own.
@WebSocketGateway({
  namespace: '/messaging',
  cors: { origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' },
})
export class MessagingGateway
  implements OnGatewayConnection, OnGatewayDisconnect, MessagingPusher
{
  private readonly logger = new Logger(MessagingGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly presence: PresenceService,
    private readonly rateLimiter: MessagingRateLimiterService,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('No token provided');
      const payload = jwt.verify(
        token,
        process.env.JWT_SECRET!,
      ) as unknown as JwtPayload;
      client.data.user = payload;

      await client.join(`user:${payload.sub}`);

      const conversations = await this.prisma.message_participants.findMany({
        where: { user_id: payload.sub },
        select: { conversation_id: true },
      });
      await Promise.all(
        conversations.map((c) =>
          Promise.resolve(client.join(`conversation:${c.conversation_id}`)),
        ),
      );

      // Still tracked (not just discarded) — MessagingService.sendMessage
      // reads this to decide delivered-vs-sent status and whether to fire an
      // offline notification. Online/offline is no longer surfaced to users.
      this.presence.addSocket(payload.sub, client.id);
    } catch (err) {
      this.logger.warn(
        `WS auth failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      client.emit('connection:error', { message: 'Authentication failed' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket): void {
    const user = client.data.user;
    this.rateLimiter.clear(client.id);
    if (!user) return;
    this.presence.removeSocket(user.sub, client.id);
  }

  @SubscribeMessage('conversation:join')
  async onConversationJoin(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: number },
  ): Promise<void> {
    const user = client.data.user;
    if (!user) return;
    // Without this check, any authenticated socket could join any
    // conversation's room by supplying an arbitrary id and silently
    // eavesdrop on someone else's messages in real time — the REST side
    // (listMessages/markRead) already enforces this via the same check.
    try {
      await this.messaging.assertParticipant(body.conversationId, user.sub);
    } catch {
      client.emit('error', {
        code: 'NOT_A_PARTICIPANT',
        message: 'You are not part of this conversation.',
      });
      return;
    }
    await client.join(`conversation:${body.conversationId}`);
  }

  @SubscribeMessage('message:send')
  async onMessageSend(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody()
    body: { conversationId: number; body: string; clientGeneratedId?: string },
  ): Promise<void> {
    const user = client.data.user;
    if (!user) return;

    if (!this.rateLimiter.allow(client.id)) {
      client.emit('error', {
        code: 'RATE_LIMITED',
        message: 'Sending too fast — slow down a little.',
        clientGeneratedId: body.clientGeneratedId,
      });
      return;
    }

    this.presence.stopTyping(body.conversationId, user.sub);

    try {
      const { message, clientGeneratedId } = await this.messaging.sendMessage(
        user.sub,
        user.role,
        {
          conversationId: body.conversationId,
          body: body.body,
          clientGeneratedId: body.clientGeneratedId,
        },
      );
      this.server
        .to(`conversation:${body.conversationId}`)
        .emit('message:new', { message });
      client.emit('message:ack', { clientGeneratedId, message });
    } catch (err) {
      const code =
        err &&
        typeof err === 'object' &&
        'response' in err &&
        (err as { response?: { errorCode?: string } }).response?.errorCode ===
          STUDENT_TO_STUDENT_BLOCKED
          ? STUDENT_TO_STUDENT_BLOCKED
          : 'SEND_FAILED';
      client.emit('error', {
        code,
        message: err instanceof Error ? err.message : 'Could not send message',
        clientGeneratedId: body.clientGeneratedId,
      });
    }
  }

  @SubscribeMessage('message:read')
  async onMessageRead(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: number; upToMessageId: number },
  ): Promise<void> {
    const user = client.data.user;
    if (!user) return;
    await this.messaging.markRead(
      user.sub,
      body.conversationId,
      body.upToMessageId,
    );
    this.server.to(`conversation:${body.conversationId}`).emit('message:read', {
      conversationId: body.conversationId,
      upToMessageId: body.upToMessageId,
      readByUserId: user.sub,
      readAt: new Date().toISOString(),
    });
  }

  @SubscribeMessage('typing:start')
  onTypingStart(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: number },
  ): void {
    const user = client.data.user;
    if (!user) return;
    this.presence.startTyping(body.conversationId, user.sub, () => {
      this.server
        .to(`conversation:${body.conversationId}`)
        .emit('typing:update', {
          conversationId: body.conversationId,
          userId: user.sub,
          isTyping: false,
        });
    });
    this.server
      .to(`conversation:${body.conversationId}`)
      .emit('typing:update', {
        conversationId: body.conversationId,
        userId: user.sub,
        isTyping: true,
      });
  }

  @SubscribeMessage('typing:stop')
  onTypingStop(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: number },
  ): void {
    const user = client.data.user;
    if (!user) return;
    this.presence.stopTyping(body.conversationId, user.sub);
    this.server
      .to(`conversation:${body.conversationId}`)
      .emit('typing:update', {
        conversationId: body.conversationId,
        userId: user.sub,
        isTyping: false,
      });
  }

  /** Called by MessagingService to push a live event to a specific user's every open tab/device — e.g. conversation:new, the moment a conversation's first-ever message lands. */
  pushToUser(userId: number, event: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  joinUserToConversation(userId: number, conversationId: number): void {
    this.server
      .in(`user:${userId}`)
      .socketsJoin(`conversation:${conversationId}`);
  }

  /** Called by MessagingService after a REST edit/delete mutation commits, to broadcast the resulting change live to every participant. */
  pushToConversation(
    conversationId: number,
    event: string,
    payload: unknown,
  ): void {
    this.server.to(`conversation:${conversationId}`).emit(event, payload);
  }
}
