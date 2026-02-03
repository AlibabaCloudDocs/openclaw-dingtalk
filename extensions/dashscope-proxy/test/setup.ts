/**
 * Test setup file for Vitest.
 * Runs before each test file.
 */
import { vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

process.env.NODE_ENV = "test";
