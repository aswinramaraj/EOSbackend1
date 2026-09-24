BEGIN;

CREATE TABLE IF NOT EXISTS message_requests (
  id                BIGSERIAL PRIMARY KEY,
  request_type      VARCHAR(20) NOT NULL,
  sender_user_id    INTEGER NOT NULL REFERENCES users(id),
  receiver_user_id  INTEGER NOT NULL REFERENCES users(id),
  conversation_id   BIGINT REFERENCES message_conversations(id) ON DELETE CASCADE,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',
  active_key        VARCHAR(60),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_message_requests_active_key
  ON message_requests (active_key)
  WHERE (active_key IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_message_requests_receiver_status
  ON message_requests (receiver_user_id, status);

CREATE INDEX IF NOT EXISTS idx_message_requests_sender_status
  ON message_requests (sender_user_id, status);

CREATE INDEX IF NOT EXISTS idx_message_requests_conversation
  ON message_requests (conversation_id);

COMMIT;
