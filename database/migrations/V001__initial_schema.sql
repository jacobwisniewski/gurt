-- V001__initial_schema.sql
-- Initial database schema for Gurt

-- Sandboxes table: tracks active/inactive sandbox sessions
CREATE TABLE sandboxes (
    thread_id VARCHAR(255) PRIMARY KEY,
    code_interpreter_id VARCHAR(255) NOT NULL,
    volume_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'idle', 'stopped')),
    context_json JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_activity TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sandboxes_status ON sandboxes(status);
CREATE INDEX idx_sandboxes_last_activity ON sandboxes(last_activity);

-- Messages table: conversation history for context
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    thread_id VARCHAR(255) NOT NULL REFERENCES sandboxes(thread_id) ON DELETE CASCADE,
    sequence_number INTEGER NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(thread_id, sequence_number)
);

CREATE INDEX idx_messages_thread_id ON messages(thread_id);
CREATE INDEX idx_messages_thread_sequence ON messages(thread_id, sequence_number);
