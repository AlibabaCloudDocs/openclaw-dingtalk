/**
 * Tests for directive tags stripping utilities.
 */
import { describe, it, expect } from "vitest";
import {
  stripDirectiveTags,
  stripDirectiveTagsPreserveFormatting,
  isOnlyDirectiveTags,
} from "./directive-tags.js";

describe("stripDirectiveTags", () => {
  it("removes [[audio_as_voice]] tag", () => {
    const input = "Hello [[audio_as_voice]] world";
    expect(stripDirectiveTags(input)).toBe("Hello world");
  });

  it("removes [[reply_to_current]] tag", () => {
    const input = "[[reply_to_current]] This is a reply";
    expect(stripDirectiveTags(input)).toBe("This is a reply");
  });

  it("removes [[reply_to:id]] tag", () => {
    const input = "[[reply_to: msg123]] Response message";
    expect(stripDirectiveTags(input)).toBe("Response message");
  });

  it("removes multiple directive tags", () => {
    const input = "[[audio_as_voice]] Hello [[reply_to_current]] world";
    expect(stripDirectiveTags(input)).toBe("Hello world");
  });

  it("removes generic [[xxx]] tags", () => {
    const input = "[[some_directive]] content [[another_one:value]]";
    expect(stripDirectiveTags(input)).toBe("content");
  });

  it("normalizes whitespace after removal", () => {
    const input = "  [[audio_as_voice]]   Hello   world  ";
    expect(stripDirectiveTags(input)).toBe("Hello world");
  });

  it("handles empty string", () => {
    expect(stripDirectiveTags("")).toBe("");
  });

  it("handles null/undefined", () => {
    expect(stripDirectiveTags(null as unknown as string)).toBe("");
    expect(stripDirectiveTags(undefined as unknown as string)).toBe("");
  });

  it("preserves regular text", () => {
    const input = "Just regular text without directives";
    expect(stripDirectiveTags(input)).toBe("Just regular text without directives");
  });

  it("handles case insensitive matching", () => {
    const input = "[[AUDIO_AS_VOICE]] [[Reply_To_Current]]";
    expect(stripDirectiveTags(input)).toBe("");
  });
});

describe("stripDirectiveTagsPreserveFormatting", () => {
  it("preserves newline while removing directive tag", () => {
    const input = "[[reply_to_current]]\n第二行";
    expect(stripDirectiveTagsPreserveFormatting(input)).toBe("\n第二行");
  });

  it("preserves newline-only chunk after tag removal", () => {
    const input = "[[audio_as_voice]]\n";
    expect(stripDirectiveTagsPreserveFormatting(input)).toBe("\n");
  });

  it("keeps a single boundary space when directive is between words", () => {
    const input = "hello[[reply_to_current]]world";
    expect(stripDirectiveTagsPreserveFormatting(input)).toBe("hello world");
  });
});

describe("isOnlyDirectiveTags", () => {
  it("returns true for only directive tags", () => {
    expect(isOnlyDirectiveTags("[[audio_as_voice]]")).toBe(true);
    expect(isOnlyDirectiveTags("[[reply_to_current]]")).toBe(true);
    expect(isOnlyDirectiveTags("[[audio_as_voice]] [[reply_to_current]]")).toBe(true);
  });

  it("returns false for text with content", () => {
    expect(isOnlyDirectiveTags("Hello [[audio_as_voice]] world")).toBe(false);
    expect(isOnlyDirectiveTags("[[reply_to_current]] Reply")).toBe(false);
  });

  it("returns true for empty string", () => {
    expect(isOnlyDirectiveTags("")).toBe(true);
  });

  it("returns true for null/undefined", () => {
    expect(isOnlyDirectiveTags(null as unknown as string)).toBe(true);
    expect(isOnlyDirectiveTags(undefined as unknown as string)).toBe(true);
  });

  it("returns true for whitespace only", () => {
    expect(isOnlyDirectiveTags("   ")).toBe(true);
  });
});
