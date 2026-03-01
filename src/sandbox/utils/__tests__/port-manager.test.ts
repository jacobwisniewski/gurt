import { describe, it, expect } from "vitest";
import { getPortForThread, getNextPort } from "../port-manager.js";

describe("GIVEN port-manager utilities", () => {
  describe("WHEN getPortForThread is called with same threadId", () => {
    it("SHOULD return same port", () => {
      const port1 = getPortForThread("thread-123");
      const port2 = getPortForThread("thread-123");
      
      expect(port1).toBe(port2);
    });
  });

  describe("WHEN getPortForThread is called with different threadIds", () => {
    it("SHOULD return different ports", () => {
      const port1 = getPortForThread("thread-abc");
      const port2 = getPortForThread("thread-xyz");
      
      expect(port1).not.toBe(port2);
    });
  });

  describe("WHEN getPortForThread returns a port", () => {
    it("SHOULD be within valid range (10000-65535)", () => {
      const port = getPortForThread("any-thread-id");
      
      expect(port).toBeGreaterThanOrEqual(10000);
      expect(port).toBeLessThanOrEqual(65535);
    });
  });

  describe("WHEN getNextPort is called", () => {
    it("SHOULD return next sequential port", () => {
      const currentPort = 10000;
      const nextPort = getNextPort(currentPort);
      
      expect(nextPort).toBe(10001);
    });
  });

  describe("WHEN getNextPort reaches max port", () => {
    it("SHOULD wrap around to min port", () => {
      const currentPort = 65535;
      const nextPort = getNextPort(currentPort);
      
      expect(nextPort).toBe(10000);
    });
  });

  describe("WHEN hashing various threadId formats", () => {
    it("SHOULD handle special characters", () => {
      const port1 = getPortForThread("thread:123");
      const port2 = getPortForThread("thread/456");
      const port3 = getPortForThread("thread-789");
      
      expect(port1).toBeGreaterThanOrEqual(10000);
      expect(port2).toBeGreaterThanOrEqual(10000);
      expect(port3).toBeGreaterThanOrEqual(10000);
    });

    it("SHOULD handle long threadIds", () => {
      const longThreadId = "a".repeat(1000);
      const port = getPortForThread(longThreadId);
      
      expect(port).toBeGreaterThanOrEqual(10000);
      expect(port).toBeLessThanOrEqual(65535);
    });
  });
});
