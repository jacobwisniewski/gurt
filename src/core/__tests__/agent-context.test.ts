import { describe, it, expect, vi } from "vitest";
import type { Thread, Message } from "chat";
import type { SlackAdapter } from "@chat-adapter/slack";
import * as AgentContext from "../agent-context.js";

const createMockThread = (overrides: Partial<Thread & { participants?: Array<{ id: string; name: string }>; messageCount?: number }> = {}): Thread =>
  ({
    id: "thread-123",
    channel: {
      id: "C123",
      name: "general",
      type: "public",
    },
    participants: [{ id: "U1", name: "alice" }],
    messageCount: 5,
    subscribe: vi.fn().mockResolvedValue(undefined),
    post: vi.fn().mockResolvedValue(undefined),
    adapter: {} as SlackAdapter,
    ...overrides,
  }) as Thread;

const createMockMessage = (overrides: Partial<Message> = {}): Message =>
  ({
    id: "msg-1",
    text: "Hello Gurt",
    author: { id: "U1", name: "alice" },
    timestamp: "2024-01-01T00:00:00Z",
    ...overrides,
  }) as Message;

describe("GIVEN an AgentContext", () => {
  describe("WHEN buildContext is called with no existing session", () => {
    it("SHOULD return context with empty sandbox", async () => {
      const mockThread = createMockThread();
      const mockMessage = createMockMessage();

      const mockSessionManager = {
        getSession: vi.fn().mockResolvedValue(null),
        getConversationHistory: vi.fn().mockResolvedValue([]),
      };

      const result = await AgentContext.buildContext(
        mockSessionManager,
        mockThread,
        mockMessage
      );

      expect(result.slack.channel.id).toBe("C123");
      expect(result.slack.channel.name).toBe("general");
      expect(result.slack.thread.id).toBe("thread-123");
      expect(result.slack.currentMessage.text).toBe("Hello Gurt");
      expect(result.slack.currentMessage.author).toBe("alice");
      expect(result.sandbox.sessionId).toBeUndefined();
      expect(result.sandbox.executionHistory).toEqual([]);
    });
  });

  describe("WHEN buildContext is called with existing session", () => {
    it("SHOULD include session information", async () => {
      const mockThread = createMockThread();
      const mockMessage = createMockMessage();

      const mockSession = {
        threadId: "thread-123",
        codeInterpreterId: "ci-456",
        volumeId: "vol-789",
        status: "active" as const,
        contextJson: {},
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      const mockHistory = [
        {
          role: "user",
          content: "Previous message",
          metadata: {
            executionLog: [
              {
                type: "command" as const,
                command: "gh run list",
                output: "Build #123 success",
                timestamp: new Date(),
                success: true,
              },
            ],
          },
          timestamp: new Date(),
        },
      ];

      const mockSessionManager = {
        getSession: vi.fn().mockResolvedValue(mockSession),
        getConversationHistory: vi.fn().mockResolvedValue(mockHistory),
      };

      const result = await AgentContext.buildContext(
        mockSessionManager,
        mockThread,
        mockMessage
      );

      expect(result.sandbox.sessionId).toBe("ci-456");
      expect(result.sandbox.executionHistory).toHaveLength(1);
      expect(result.sandbox.executionHistory[0].command).toBe("gh run list");
      expect(result.slack.history).toHaveLength(1);
    });
  });

  describe("WHEN buildContext processes conversation history", () => {
    it("SHOULD extract execution history from message metadata", async () => {
      const mockThread = createMockThread();
      const mockMessage = createMockMessage();

      const mockSession = {
        threadId: "thread-123",
        codeInterpreterId: "ci-456",
        volumeId: "vol-789",
        status: "active" as const,
        contextJson: {},
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      const mockHistory = [
        {
          role: "assistant",
          content: "Build status",
          metadata: {
            executionLog: [
              {
                type: "command" as const,
                command: "gh run list --repo test",
                output: "✓ Build passed",
                timestamp: "2024-01-01T00:00:00Z",
                success: true,
              },
              {
                type: "command" as const,
                command: "nr deployments list",
                output: "Error: not found",
                timestamp: "2024-01-02T00:00:00Z",
                success: false,
              },
            ],
          },
          timestamp: new Date(),
        },
      ];

      const mockSessionManager = {
        getSession: vi.fn().mockResolvedValue(mockSession),
        getConversationHistory: vi.fn().mockResolvedValue(mockHistory),
      };

      const result = await AgentContext.buildContext(
        mockSessionManager,
        mockThread,
        mockMessage
      );

      expect(result.sandbox.executionHistory).toHaveLength(2);
      // Execution history is reversed (most recent first)
      expect(result.sandbox.executionHistory[0].command).toBe(
        "nr deployments list"
      );
      expect(result.sandbox.executionHistory[0].success).toBe(false);
      expect(result.sandbox.executionHistory[1].command).toBe(
        "gh run list --repo test"
      );
      expect(result.sandbox.executionHistory[1].success).toBe(true);
    });

    it("SHOULD handle messages without execution log metadata", async () => {
      const mockThread = createMockThread();
      const mockMessage = createMockMessage();

      const mockHistory = [
        {
          role: "user",
          content: "Simple question",
          metadata: {},
          timestamp: new Date(),
        },
        {
          role: "assistant",
          content: "Simple answer",
          metadata: null,
          timestamp: new Date(),
        },
      ];

      const mockSessionManager = {
        getSession: vi.fn().mockResolvedValue(null),
        getConversationHistory: vi.fn().mockResolvedValue(mockHistory),
      };

      const result = await AgentContext.buildContext(
        mockSessionManager,
        mockThread,
        mockMessage
      );

      expect(result.sandbox.executionHistory).toEqual([]);
    });
  });

  describe("WHEN processing thread participants", () => {
    it("SHOULD extract participant names", async () => {
      const mockThread = createMockThread({
        participants: [
          { id: "U1", name: "alice" },
          { id: "U2", name: "bob" },
          { id: "U3", name: "charlie" },
        ],
      });
      const mockMessage = createMockMessage();

      const mockSessionManager = {
        getSession: vi.fn().mockResolvedValue(null),
        getConversationHistory: vi.fn().mockResolvedValue([]),
      };

      const result = await AgentContext.buildContext(
        mockSessionManager,
        mockThread,
        mockMessage
      );

      expect(result.slack.thread.participants).toEqual(["alice", "bob", "charlie"]);
    });
  });

  describe("WHEN conversation history is empty", () => {
    it("SHOULD return empty history array", async () => {
      const mockThread = createMockThread();
      const mockMessage = createMockMessage();

      const mockSessionManager = {
        getSession: vi.fn().mockResolvedValue(null),
        getConversationHistory: vi.fn().mockResolvedValue([]),
      };

      const result = await AgentContext.buildContext(
        mockSessionManager,
        mockThread,
        mockMessage
      );

      expect(result.slack.history).toEqual([]);
    });
  });
});
