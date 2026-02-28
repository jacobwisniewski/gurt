import { describe, it, expect } from "vitest";
import type { SandboxTable, MessageTable } from "../database.js";

describe("GIVEN the database types", () => {
  describe("WHEN using SandboxTable interface", () => {
    it("SHOULD allow valid sandbox data", () => {
      const sandbox: SandboxTable = {
        thread_id: "thread-123",
        code_interpreter_id: "ci-456",
        volume_id: "vol-789",
        status: "active",
        context_json: { user: { id: "u1", name: "test" } },
        created_at: new Date(),
        last_activity: new Date(),
      };

      expect(sandbox.thread_id).toBe("thread-123");
      expect(sandbox.status).toBe("active");
    });

    it("SHOULD allow all valid statuses", () => {
      const statuses: Array<SandboxTable["status"]> = ["active", "idle", "stopped"];

      for (const status of statuses) {
        const sandbox: SandboxTable = {
          thread_id: `thread-${status}`,
          code_interpreter_id: "ci-123",
          volume_id: "vol-456",
          status,
          context_json: {},
          created_at: new Date(),
          last_activity: new Date(),
        };

        expect(sandbox.status).toBe(status);
      }
    });
  });

  describe("WHEN using MessageTable interface", () => {
    it("SHOULD allow valid message data", () => {
      const message: MessageTable = {
        thread_id: "thread-123",
        sequence_number: 1,
        role: "user",
        content: "Hello",
        metadata: { key: "value" },
        created_at: new Date(),
      };

      expect(message.thread_id).toBe("thread-123");
      expect(message.role).toBe("user");
      expect(message.sequence_number).toBe(1);
    });

    it("SHOULD allow optional id field", () => {
      const messageWithoutId: MessageTable = {
        thread_id: "thread-123",
        sequence_number: 1,
        role: "assistant",
        content: "Hi",
        metadata: {},
        created_at: new Date(),
      };

      expect(messageWithoutId.id).toBeUndefined();
    });

    it("SHOULD allow all valid roles", () => {
      const roles: Array<MessageTable["role"]> = ["user", "assistant", "system"];

      for (const role of roles) {
        const message: MessageTable = {
          thread_id: `thread-${role}`,
          sequence_number: 1,
          role,
          content: "Test",
          metadata: {},
          created_at: new Date(),
        };

        expect(message.role).toBe(role);
      }
    });
  });
});
