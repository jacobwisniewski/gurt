import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { LanguageModel } from "ai";
import type { AgentContext } from "../../core/agent-context.js";

// Mock the ai module
const mockGenerateText = vi.fn();

vi.mock("ai", () => ({
  generateText: mockGenerateText,
}));

const createMockModel = (): LanguageModel =>
  ({
    doGenerate: vi.fn(),
  }) as unknown as LanguageModel;

const createMockContext = (overrides: Partial<AgentContext> = {}): AgentContext =>
  ({
    slack: {
      channel: {
        id: "C123",
        name: "general",
        type: "public",
      },
      thread: {
        id: "thread-123",
        participants: ["alice"],
        messageCount: 5,
      },
      currentMessage: {
        text: "Check my builds",
        author: "alice",
        timestamp: "2024-01-01T00:00:00Z",
      },
      history: [],
    },
    sandbox: {
      executionHistory: [],
    },
    ...overrides,
  });

describe("GIVEN an Agent", () => {
  beforeAll(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe("WHEN decide is called with a command request", () => {
    it("SHOULD return requiresSandbox: true", async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({
          requiresSandbox: true,
          prompt: "Check GitHub Actions builds",
          reasoning: "User asked to check builds",
        }),
      });

      const { decide } = await import("../index.js");
      const mockModel = createMockModel();
      const context = createMockContext();

      const result = await decide({ model: mockModel }, context);

      expect(result.requiresSandbox).toBe(true);
      expect(result.prompt).toBe("Check GitHub Actions builds");
      expect(mockGenerateText).toHaveBeenCalledOnce();
    });
  });

  describe("WHEN decide is called with a simple question", () => {
    it("SHOULD return requiresSandbox: false", async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({
          requiresSandbox: false,
          response: "Use 'gh --help' to see available commands",
          reasoning: "Simple question about CLI usage",
        }),
      });

      const { decide } = await import("../index.js");
      const mockModel = createMockModel();
      const context = createMockContext({
        slack: {
          ...createMockContext().slack,
          currentMessage: {
            text: "How do I use gh CLI?",
            author: "alice",
            timestamp: "2024-01-01T00:00:00Z",
          },
        },
      });

      const result = await decide({ model: mockModel }, context);

      expect(result.requiresSandbox).toBe(false);
      expect(result.response).toBe("Use 'gh --help' to see available commands");
    });
  });

  describe("WHEN parsing a valid JSON decision", () => {
    it("SHOULD extract all fields correctly", async () => {
      const decisionJson = {
        requiresSandbox: true,
        prompt: "Run gh run list",
        response: undefined,
        reasoning: "User wants to check builds",
      };

      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify(decisionJson),
      });

      const { decide } = await import("../index.js");
      const mockModel = createMockModel();
      const context = createMockContext();

      const result = await decide({ model: mockModel }, context);

      expect(result).toEqual({
        requiresSandbox: true,
        prompt: "Run gh run list",
        response: undefined,
        reasoning: "User wants to check builds",
      });
    });
  });

  describe("WHEN parsing invalid JSON", () => {
    it("SHOULD fallback to requiresSandbox: true with text as prompt", async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: "Just run the command directly",
      });

      const { decide } = await import("../index.js");
      const mockModel = createMockModel();
      const context = createMockContext();

      const result = await decide({ model: mockModel }, context);

      expect(result.requiresSandbox).toBe(true);
      expect(result.prompt).toBe("Just run the command directly");
      expect(result.reasoning).toContain("Fallback");
    });
  });

  describe("WHEN parsing malformed JSON", () => {
    it("SHOULD fallback gracefully", async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: "{ invalid json }",
      });

      const { decide } = await import("../index.js");
      const mockModel = createMockModel();
      const context = createMockContext();

      const result = await decide({ model: mockModel }, context);

      expect(result.requiresSandbox).toBe(true);
      expect(result.reasoning).toContain("Fallback");
    });
  });

  describe("WHEN decision includes execution history in context", () => {
    it("SHOULD include execution history in the prompt", async () => {
      let capturedPrompt = "";
      mockGenerateText.mockImplementationOnce(({ prompt }: { prompt: string }) => {
        capturedPrompt = prompt;
        return Promise.resolve({
          text: JSON.stringify({
            requiresSandbox: true,
            prompt: "Get logs for failed build",
            reasoning: "Need to investigate failure",
          }),
        });
      });

      const { decide } = await import("../index.js");
      const mockModel = createMockModel();
      const context = createMockContext({
        sandbox: {
          sessionId: "ci-123",
          executionHistory: [
            {
              command: "gh run list",
              output: "Build #456 failed",
              timestamp: new Date(),
              success: false,
            },
          ],
        },
      });

      await decide({ model: mockModel }, context);

      expect(capturedPrompt).toContain("Execution History");
      expect(capturedPrompt).toContain("gh run list");
      expect(capturedPrompt).toContain("(failed)");
    });
  });
});
