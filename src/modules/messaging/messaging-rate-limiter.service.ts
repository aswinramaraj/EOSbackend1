import { Injectable } from '@nestjs/common';

const WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_WINDOW = 10;

/**
 * Self-contained per-socket flood guard, scoped only to this gateway — does
 * NOT touch the app's existing global HTTP ThrottlerModule/APP_GUARD
 * registration (a standing project rule), and that guard structurally
 * wouldn't apply to Socket.IO events anyway.
 */
@Injectable()
export class MessagingRateLimiterService {
  private windows = new Map<
    string,
    { count: number; windowStartedAt: number }
  >();

  /** Returns true if this send should be allowed; false if the socket has exceeded its rate. */
  allow(socketId: string): boolean {
    const now = Date.now();
    const entry = this.windows.get(socketId);
    if (!entry || now - entry.windowStartedAt > WINDOW_MS) {
      this.windows.set(socketId, { count: 1, windowStartedAt: now });
      return true;
    }
    entry.count += 1;
    return entry.count <= MAX_MESSAGES_PER_WINDOW;
  }

  clear(socketId: string): void {
    this.windows.delete(socketId);
  }
}
