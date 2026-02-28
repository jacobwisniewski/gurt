import { describe, it, expect, vi } from "vitest";
import type { Kysely } from "kysely";
import type { Logger } from "pino";
import type { Database } from "../../config/database.js";
import * as SessionManager from "../session-manager.js";

const createMockDb = () =>
  ({
    selectFrom: vi.fn(),
    insertInto: vi.fn(),
    updateTable: vi.fn(),
    deleteFrom: vi.fn(),
  }) as unknown as Kysely<Database>;

const createMockLogger = () =>
  ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }) as unknown as Logger;

describe("GIVEN a SessionManager", () => {
  describe("WHEN getSession is called with existing thread", () => {
    it("SHOULD return the session", async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const mockSession = {
        thread_id: "thread-123",
        code_interpreter_id: "ci-456",
        volume_id: "vol-789",
        status: "active" as const,
        context_json: { user: { id: "u1", name: "test" } },
        created_at: new Date("2024-01-01"),
        last_activity: new Date("2024-01-02"),
      };

      const selectFromMock = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          selectAll: vi.fn().mockReturnValue({
            executeTakeFirst: vi.fn().mockResolvedValue(mockSession),
          }),
        }),
      });
      (mockDb.selectFrom as ReturnType<typeof vi.fn>).mockImplementation(
        selectFromMock
      );

      const result = await SessionManager.getSession(
        { db: mockDb, logger: mockLogger },
        "thread-123"
      );

      expect(result).toEqual({
        threadId: "thread-123",
        codeInterpreterId: "ci-456",
        volumeId: "vol-789",
        status: "active",
        contextJson: { user: { id: "u1", name: "test" } },
        createdAt: new Date("2024-01-01"),
        lastActivity: new Date("2024-01-02"),
      });
      expect(selectFromMock).toHaveBeenCalledWith("sandboxes");
    });
  });

  describe("WHEN getSession is called with non-existing thread", () => {
    it("SHOULD return null", async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();

      const selectFromMock = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          selectAll: vi.fn().mockReturnValue({
            executeTakeFirst: vi.fn().mockResolvedValue(null),
          }),
        }),
      });
      (mockDb.selectFrom as ReturnType<typeof vi.fn>).mockImplementation(
        selectFromMock
      );

      const result = await SessionManager.getSession(
        { db: mockDb, logger: mockLogger },
        "thread-999"
      );

      expect(result).toBeNull();
    });
  });

  describe("WHEN createSession is called", () => {
    it("SHOULD insert session into database", async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const executeMock = vi.fn().mockResolvedValue(undefined);

      const insertIntoMock = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          execute: executeMock,
        }),
      });
      (mockDb.insertInto as ReturnType<typeof vi.fn>).mockImplementation(
        insertIntoMock
      );

      const context = {
        user: { id: "u1", name: "testuser" },
        channel: { id: "c1", name: "general" },
      };

      const result = await SessionManager.createSession(
        { db: mockDb, logger: mockLogger },
        "thread-123",
        "ci-456",
        "vol-789",
        context
      );

      expect(result.threadId).toBe("thread-123");
      expect(result.codeInterpreterId).toBe("ci-456");
      expect(result.volumeId).toBe("vol-789");
      expect(result.status).toBe("active");
      expect(result.contextJson).toEqual(context);
      expect(insertIntoMock).toHaveBeenCalledWith("sandboxes");
      expect(executeMock).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        { threadId: "thread-123", codeInterpreterId: "ci-456", volumeId: "vol-789" },
        "Created session in database"
      );
    });
  });

  describe("WHEN updateLastActivity is called", () => {
    it("SHOULD update the last_activity timestamp", async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const executeMock = vi.fn().mockResolvedValue(undefined);

      const updateTableMock = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            execute: executeMock,
          }),
        }),
      });
      (mockDb.updateTable as ReturnType<typeof vi.fn>).mockImplementation(
        updateTableMock
      );

      await SessionManager.updateLastActivity(
        { db: mockDb, logger: mockLogger },
        "thread-123"
      );

      expect(updateTableMock).toHaveBeenCalledWith("sandboxes");
      expect(executeMock).toHaveBeenCalled();
    });
  });

  describe("WHEN updateStatus is called", () => {
    it("SHOULD update the session status", async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const executeMock = vi.fn().mockResolvedValue(undefined);

      const updateTableMock = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            execute: executeMock,
          }),
        }),
      });
      (mockDb.updateTable as ReturnType<typeof vi.fn>).mockImplementation(
        updateTableMock
      );

      await SessionManager.updateStatus(
        { db: mockDb, logger: mockLogger },
        "thread-123",
        "stopped"
      );

      expect(updateTableMock).toHaveBeenCalledWith("sandboxes");
      expect(executeMock).toHaveBeenCalled();
    });
  });

  describe("WHEN deleteSession is called", () => {
    it("SHOULD delete the session from database", async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const executeMock = vi.fn().mockResolvedValue(undefined);

      const deleteFromMock = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          execute: executeMock,
        }),
      });
      (mockDb.deleteFrom as ReturnType<typeof vi.fn>).mockImplementation(
        deleteFromMock
      );

      await SessionManager.deleteSession(
        { db: mockDb, logger: mockLogger },
        "thread-123"
      );

      expect(deleteFromMock).toHaveBeenCalledWith("sandboxes");
      expect(executeMock).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        { threadId: "thread-123" },
        "Deleted session from database"
      );
    });
  });

  describe("WHEN saveMessage is called", () => {
    it("SHOULD insert message with correct sequence number", async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const executeMock = vi.fn().mockResolvedValue(undefined);

      const selectFromMock = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockResolvedValue({ sequence_number: 5 }),
            }),
          }),
        }),
      });

      const insertIntoMock = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          execute: executeMock,
        }),
      });

      (mockDb.selectFrom as ReturnType<typeof vi.fn>).mockImplementation(
        selectFromMock
      );
      (mockDb.insertInto as ReturnType<typeof vi.fn>).mockImplementation(
        insertIntoMock
      );

      await SessionManager.saveMessage(
        { db: mockDb, logger: mockLogger },
        "thread-123",
        "user",
        "Hello",
        { key: "value" }
      );

      expect(insertIntoMock).toHaveBeenCalledWith("messages");
      const valuesCall = (insertIntoMock().values as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(valuesCall.sequence_number).toBe(6);
      expect(valuesCall.role).toBe("user");
      expect(valuesCall.content).toBe("Hello");
    });

    it("SHOULD use sequence number 1 when no previous messages", async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();
      const executeMock = vi.fn().mockResolvedValue(undefined);

      const selectFromMock = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockResolvedValue(null),
            }),
          }),
        }),
      });

      const insertIntoMock = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          execute: executeMock,
        }),
      });

      (mockDb.selectFrom as ReturnType<typeof vi.fn>).mockImplementation(
        selectFromMock
      );
      (mockDb.insertInto as ReturnType<typeof vi.fn>).mockImplementation(
        insertIntoMock
      );

      await SessionManager.saveMessage(
        { db: mockDb, logger: mockLogger },
        "thread-123",
        "assistant",
        "Hi there"
      );

      const valuesCall = (insertIntoMock().values as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(valuesCall.sequence_number).toBe(1);
    });
  });

  describe("WHEN getConversationHistory is called", () => {
    it("SHOULD return messages in chronological order", async () => {
      const mockDb = createMockDb();
      const mockLogger = createMockLogger();

      const mockMessages = [
        {
          role: "assistant",
          content: "Response 2",
          metadata: {},
          created_at: new Date("2024-01-02"),
        },
        {
          role: "user",
          content: "Message 2",
          metadata: {},
          created_at: new Date("2024-01-02"),
        },
      ];

      const selectFromMock = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              selectAll: vi.fn().mockReturnValue({
                execute: vi.fn().mockResolvedValue(mockMessages),
              }),
            }),
          }),
        }),
      });
      (mockDb.selectFrom as ReturnType<typeof vi.fn>).mockImplementation(
        selectFromMock
      );

      const result = await SessionManager.getConversationHistory(
        { db: mockDb, logger: mockLogger },
        "thread-123",
        10
      );

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("user");
      expect(result[1].role).toBe("assistant");
    });
  });
});
