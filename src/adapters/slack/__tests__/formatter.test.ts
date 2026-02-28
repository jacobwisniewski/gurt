import { describe, it, expect } from "vitest";
import { formatResponse, extractResponseText } from "../formatter.js";

describe("GIVEN a formatResponse function", () => {
  describe("WHEN text is under max length", () => {
    it("SHOULD return text unchanged", () => {
      const shortText = "This is a short message";

      const result = formatResponse(shortText);

      expect(result).toBe(shortText);
    });
  });

  describe("WHEN text exceeds max length", () => {
    it("SHOULD truncate and add ellipsis", () => {
      const longText = "a".repeat(3500);

      const result = formatResponse(longText);

      expect(result.length).toBeLessThanOrEqual(3000);
      expect(result).toContain("... (truncated");
      expect(result).toContain("use a file attachment for full output)");
    });

    it("SHOULD preserve the beginning of the text", () => {
      const longText = "Important header\n" + "a".repeat(3500);

      const result = formatResponse(longText);

      expect(result.startsWith("Important header")).toBe(true);
    });
  });

  describe("WHEN text is exactly at max length", () => {
    it("SHOULD return text unchanged", () => {
      const exactText = "a".repeat(3000);

      const result = formatResponse(exactText);

      expect(result).toBe(exactText);
    });
  });

  describe("WHEN text is empty", () => {
    it("SHOULD return empty string", () => {
      const result = formatResponse("");

      expect(result).toBe("");
    });
  });
});

describe("GIVEN an extractResponseText function", () => {
  describe("WHEN data has text parts", () => {
    it("SHOULD extract and join text parts", () => {
      const data = {
        parts: [
          { type: "text", text: "Line 1" },
          { type: "text", text: "Line 2" },
        ],
      };

      const result = extractResponseText(data);

      expect(result).toBe("Line 1\nLine 2");
    });
  });

  describe("WHEN data has mixed part types", () => {
    it("SHOULD only extract text parts", () => {
      const data = {
        parts: [
          { type: "text", text: "Hello" },
          { type: "image", url: "http://example.com/img.png" },
          { type: "text", text: "World" },
          { type: "code", code: "const x = 1;" },
        ],
      };

      const result = extractResponseText(data);

      expect(result).toBe("Hello\nWorld");
    });
  });

  describe("WHEN data has no parts", () => {
    it("SHOULD return 'No response'", () => {
      const data = {};

      const result = extractResponseText(data);

      expect(result).toBe("No response");
    });
  });

  describe("WHEN data has empty parts array", () => {
    it("SHOULD return 'No response'", () => {
      const data = {
        parts: [],
      };

      const result = extractResponseText(data);

      expect(result).toBe("No response");
    });
  });

  describe("WHEN text parts have undefined text", () => {
    it("SHOULD include empty strings for undefined text", () => {
      const data = {
        parts: [
          { type: "text", text: "Hello" },
          { type: "text" },
          { type: "text", text: "World" },
        ],
      };

      const result = extractResponseText(data);

      expect(result).toBe("Hello\n\nWorld");
    });
  });

  describe("WHEN all parts are non-text types", () => {
    it("SHOULD return empty string", () => {
      const data = {
        parts: [
          { type: "image", url: "http://example.com/img.png" },
          { type: "code", code: "const x = 1;" },
        ],
      };

      const result = extractResponseText(data);

      expect(result).toBe("");
    });
  });
});
