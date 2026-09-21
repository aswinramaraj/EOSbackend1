import { Controller, Get } from '@nestjs/common';
import { CanteenQueueService } from './canteen-queue.service';

/**
 * Public, unauthenticated REST endpoints backing the Kitchen/Counter Display
 * kiosk screens — used for their initial page load and their slow
 * background resync poll (the WebSocket gateway is the primary channel).
 * Deliberately has no @UseGuards: the first genuinely public controller in
 * this backend, justified because the payloads carry zero PII (see
 * CanteenQueueService) and this is a read-only, unauthenticated wall
 * display by design, not an oversight.
 */
@Controller('canteen-queue')
export class CanteenQueueController {
  constructor(private readonly queue: CanteenQueueService) {}

  @Get('kitchen')
  getKitchen() {
    return this.queue.getKitchenQueue();
  }

  @Get('counter')
  getCounter() {
    return this.queue.getCounterQueue();
  }
}
