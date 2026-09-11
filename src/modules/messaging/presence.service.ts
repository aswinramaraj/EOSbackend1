import { Injectable } from '@nestjs/common';

const TYPING_TIMEOUT_MS = 3000;

/**
 * Single-instance, in-memory presence/typing state — this app runs as one
 * Render web service, so a plain Map is sufficient for v1. If this ever
 * scales to multiple instances, presence/typing will desync across them;
 * the fix at that point is @socket.io/redis-adapter, deliberately not
 * built now since it isn't needed for the current deployment.
 */
@Injectable()
export class PresenceService {
  private onlineSockets = new Map<number, Set<string>>();
  private typingTimers = new Map<string, NodeJS.Timeout>();

  /** This user now has one more open socket (a new tab/device connected). */
  addSocket(userId: number, socketId: string): void {
    const existing = this.onlineSockets.get(userId);
    if (existing) existing.add(socketId);
    else this.onlineSockets.set(userId, new Set([socketId]));
  }

  /** One of this user's sockets disconnected — drops it, clearing the entry entirely once none are left. */
  removeSocket(userId: number, socketId: string): void {
    const existing = this.onlineSockets.get(userId);
    if (!existing) return;
    existing.delete(socketId);
    if (existing.size === 0) this.onlineSockets.delete(userId);
  }

  isOnline(userId: number): boolean {
    return (this.onlineSockets.get(userId)?.size ?? 0) > 0;
  }

  /**
   * Server-authoritative typing timeout: resets a 3s timer on every
   * typing:start; on fire, `onTimeout` should emit typing:update{false} —
   * this stays correct even if the client's own typing:stop never arrives
   * (backgrounded tab, dropped connection).
   */
  startTyping(
    conversationId: number,
    userId: number,
    onTimeout: () => void,
  ): void {
    const key = `${conversationId}:${userId}`;
    const existing = this.typingTimers.get(key);
    if (existing) clearTimeout(existing);
    this.typingTimers.set(
      key,
      setTimeout(() => {
        this.typingTimers.delete(key);
        onTimeout();
      }, TYPING_TIMEOUT_MS),
    );
  }

  stopTyping(conversationId: number, userId: number): void {
    const key = `${conversationId}:${userId}`;
    const existing = this.typingTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.typingTimers.delete(key);
    }
  }
}
