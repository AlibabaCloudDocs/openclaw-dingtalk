/**
 * Test setup file for Vitest.
 * Runs before each test file.
 */
import { vi, beforeEach, afterEach } from "vitest";

// Reset all mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Mock environment variables for testing
process.env.NODE_ENV = "test";
