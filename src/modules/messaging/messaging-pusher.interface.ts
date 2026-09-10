/**
 * MessagingService needs to push live socket events (e.g. a brand-new
 * conversation created via REST, or an edit/delete broadcast) but must not
 * import the concrete MessagingGateway class directly — that class also
 * imports MessagingService for its own method calls, and TypeScript's
 * emitDecoratorMetadata embeds the raw class reference in each file's
 * design:paramtypes at module-evaluation time, which throws a real
 * "Cannot access before initialization" ReferenceError under a genuine
 * circular FILE import. Depending on this interface + token instead of the
 * concrete class breaks that specific cycle.
 *
 * This does NOT remove the underlying circular *dependency* though —
 * messaging.module.ts still aliases MESSAGING_PUSHER to the same
 * MessagingGateway instance (`useExisting`), so resolving MessagingService
 * still transitively requires MessagingGateway (which itself depends on
 * MessagingService) to be constructed first. That part is a real, separate
 * problem — NestJS's DI container needs `forwardRef()` on the
 * `@Inject(MESSAGING_PUSHER)` call in MessagingService for this circular
 * provider graph to resolve at all. Without it, bootstrap doesn't throw —
 * it silently exits (process.exit-like, no stack trace) right after DI
 * finishes, before any routes are ever mapped. Confirmed by bisection.
 */
export interface MessagingPusher {
  pushToUser(userId: number, event: string, payload: unknown): void;
  pushToConversation(
    conversationId: number,
    event: string,
    payload: unknown,
  ): void;
  /** Forces every open socket of this user to join the conversation's room — used when a conversation becomes visible to them for the first time (their first-ever message in it), so subsequent live pushes reach them without waiting for their next reconnect. */
  joinUserToConversation(userId: number, conversationId: number): void;
}

export const MESSAGING_PUSHER = Symbol('MESSAGING_PUSHER');
