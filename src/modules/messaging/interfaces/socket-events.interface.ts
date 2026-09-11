// Full client<->server event contract for the /messaging namespace.

export interface ClientToServerEvents {
  'conversation:join': (payload: { conversationId: number }) => void;
  'message:send': (payload: {
    conversationId: number;
    body: string;
    clientGeneratedId?: string;
  }) => void;
  'message:delivered': (payload: {
    conversationId: number;
    messageId: number;
  }) => void;
  'message:read': (payload: {
    conversationId: number;
    upToMessageId: number;
  }) => void;
  'typing:start': (payload: { conversationId: number }) => void;
  'typing:stop': (payload: { conversationId: number }) => void;
}

export interface ServerToClientEvents {
  'connection:error': (payload: { message: string }) => void;
  'message:new': (payload: { message: MessagePayload }) => void;
  'message:ack': (payload: {
    clientGeneratedId?: string;
    message: MessagePayload;
  }) => void;
  'message:deliveredAck': (payload: {
    conversationId: number;
    messageId: number;
    deliveredAt: string;
  }) => void;
  'message:read': (payload: {
    conversationId: number;
    upToMessageId: number;
    readByUserId: number;
    readAt: string;
  }) => void;
  'message:edited': (payload: {
    conversationId: number;
    messageId: number;
    body: string;
    editedAt: string;
  }) => void;
  'message:deleted': (payload: {
    conversationId: number;
    messageId: number;
    deletedAt: string;
  }) => void;
  'typing:update': (payload: {
    conversationId: number;
    userId: number;
    isTyping: boolean;
  }) => void;
  'presence:update': (payload: {
    userId: number;
    status: 'online' | 'offline';
    lastSeenAt?: string;
  }) => void;
  'conversation:new': (payload: { conversation: unknown }) => void;
  error: (payload: { code: string; message: string }) => void;
}

export interface MessagePayload {
  id: number;
  conversationId: number;
  senderUserId: number;
  body: string | null;
  status: string;
  createdAt: string;
  deliveredAt: string | null;
}
