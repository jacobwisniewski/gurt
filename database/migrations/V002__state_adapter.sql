-- V002__state_adapter.sql
-- PostgreSQL state adapter tables for chat-sdk

-- Thread subscriptions - tracks which threads the bot is monitoring
CREATE TABLE thread_subscriptions (
    thread_id VARCHAR(255) PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_thread_subscriptions_created_at ON thread_subscriptions(created_at);

-- State cache - key-value store with TTL support
CREATE TABLE state_cache (
    key VARCHAR(512) PRIMARY KEY,
    value JSONB NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_state_cache_expires_at ON state_cache(expires_at) WHERE expires_at IS NOT NULL;

-- State locks - distributed locking for thread processing
CREATE TABLE state_locks (
    thread_id VARCHAR(255) PRIMARY KEY,
    token VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_state_locks_expires_at ON state_locks(expires_at);
