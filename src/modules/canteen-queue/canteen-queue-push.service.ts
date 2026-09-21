import { Injectable, Logger } from '@nestjs/common';
import { CanteenQueueGateway } from './canteen-queue.gateway';

/**
 * Thin push wrapper injected by the order-mutating services
 * (CanteenOrderingService, CanteenOnlineOrdersService) — every method is
 * fire-and-forget by design: a WebSocket broadcast failure must never fail
 * the REST mutation that triggered it, so callers just call these without
 * awaiting or wrapping in try/catch.
 */
@Injectable()
export class CanteenQueuePushService {
  private readonly logger = new Logger(CanteenQueuePushService.name);

  constructor(private readonly gateway: CanteenQueueGateway) {}

  pushKitchenUpdate(): void {
    this.gateway
      .broadcastKitchen()
      .catch((err) =>
        this.logger.error('Failed to broadcast kitchen queue update', err),
      );
  }

  pushCounterUpdate(): void {
    this.gateway
      .broadcastCounter()
      .catch((err) =>
        this.logger.error('Failed to broadcast counter queue update', err),
      );
  }
}
