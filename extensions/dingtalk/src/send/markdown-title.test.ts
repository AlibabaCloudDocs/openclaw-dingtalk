import { describe, it, expect } from "vitest";
import { deriveMarkdownTitle } from "./markdown-title.js";

describe("deriveMarkdownTitle", () => {
  it("derives from heading", () => {
    expect(deriveMarkdownTitle("# Hello\n\nWorld")).toBe("Hello");
  });

  it("derives from plain text", () => {
    expect(deriveMarkdownTitle("你好\n第二行")).toBe("你好");
  });

  it("skips code fence lines", () => {
    expect(deriveMarkdownTitle("```ts\nconsole.log(1)\n```")).toBe("console.log(1)");
  });

  it("falls back when empty", () => {
    expect(deriveMarkdownTitle("   \n")).toBe("Clawdbot");
    expect(deriveMarkdownTitle("", { fallback: "Bot" })).toBe("Bot");
  });

  it("truncates long titles", () => {
    const t = deriveMarkdownTitle("A".repeat(100), { maxLen: 10 });
    expect(t).toBe("AAAAAAA...");
  });
});

