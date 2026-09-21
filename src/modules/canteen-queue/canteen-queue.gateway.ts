import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { CanteenQueueService } from './canteen-queue.service';

type DisplayScreen = 'kitchen' | 'counter';

function roomFor(screen: DisplayScreen): string {
  return screen === 'kitchen' ? 'kitchen-display' : 'counter-display';
}

/**
 * Public, unauthenticated namespace for the Kitchen Display and Counter
 * Display kiosk screens — no JWT, no login, matching the physical reality of
 * a wall-mounted TV with nobody signed in next to it. Deliberately not
 * mirroring messaging.gateway.ts's JWT-in-handshake pattern: there is
 * nothing here to authorize (CanteenQueueService's query shapes never
 * include orderer identity or item detail on the counter side).
 */
@WebSocketGateway({
  namespace: '/canteen-queue',
  cors: { origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' },
})
export class CanteenQueueGateway implements OnGatewayConnection {
  private readonly logger = new Logger(CanteenQueueGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly queue: CanteenQueueService) {}

  async handleConnection(client: Socket): Promise<void> {
    const screen = client.handshake.query.screen as string | undefined;
    if (screen !== 'kitchen' && screen !== 'counter') {
      client.disconnect(true);
      return;
    }

    await client.join(roomFor(screen));

    // An immediate personalized snapshot on join, rather than making a
    // freshly-connected (or just-reconnected) kiosk wait for the next
    // broadcast someone else's action happens to trigger.
    try {
      if (screen === 'kitchen') {
        client.emit('kitchen:queue', await this.queue.getKitchenQueue());
      } else {
        client.emit('counter:queue', await this.queue.getCounterQueue());
      }
    } catch (err) {
      this.logger.error('Failed to send initial queue snapshot', err);
    }
  }

  async broadcastKitchen(): Promise<void> {
    const payload = await this.queue.getKitchenQueue();
    this.server.to(roomFor('kitchen')).emit('kitchen:queue', payload);
  }

  async broadcastCounter(): Promise<void> {
    const payload = await this.queue.getCounterQueue();
    this.server.to(roomFor('counter')).emit('counter:queue', payload);
  }
}
