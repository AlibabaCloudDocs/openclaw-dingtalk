/**
 * Tests for markdown conversion utilities.
 */
import { describe, it, expect } from "vitest";
import { convertMarkdownForDingTalk } from "./markdown.js";

describe("convertMarkdownForDingTalk", () => {
  it("wraps markdown tables in code blocks", () => {
    const input = `Some text

| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |

More text`;

    const result = convertMarkdownForDingTalk(input);

    expect(result).toContain("```");
    expect(result).toContain("| Header 1 | Header 2 |");
    expect(result).toContain("Some text");
    expect(result).toContain("More text");
  });

  it("handles multiple tables", () => {
    const input = `Table 1:

| A | B |
|---|---|
| 1 | 2 |

Table 2:

| C | D |
|---|---|
| 3 | 4 |`;

    const result = convertMarkdownForDingTalk(input);

    // Each table should be wrapped
    const codeBlockCount = (result.match(/```/g) || []).length;
    expect(codeBlockCount).toBe(4); // 2 tables x 2 fences each
  });

  it("does not modify text without tables", () => {
    const input = "Just some regular text\nWith multiple lines\n\nAnd paragraphs.";
    const result = convertMarkdownForDingTalk(input);
    expect(result).toBe("Just some regular text  \nWith multiple lines\n\nAnd paragraphs.");
  });

  it("keeps tables unwrapped when tableMode is off", () => {
    const input = `| A | B |
|---|---|
| 1 | 2 |`;

    const result = convertMarkdownForDingTalk(input, { tableMode: "off" });
    expect(result).not.toContain("```");
    expect(result).toBe(`| A | B |  
|---|---|  
| 1 | 2 |`);
  });

  it("handles table at end of text", () => {
    const input = `Some text

| A | B |
|---|---|
| 1 | 2 |`;

    const result = convertMarkdownForDingTalk(input);
    expect(result).toContain("```");
    expect(result).toContain("Some text");
  });

  it("handles table at start of text", () => {
    const input = `| A | B |
|---|---|
| 1 | 2 |

Some text`;

    const result = convertMarkdownForDingTalk(input);
    expect(result).toContain("```");
    expect(result).toContain("Some text");
  });

  it("handles lines with only one pipe character", () => {
    // A line needs to have pipe at start AND contain another pipe to be a table line
    const input = "| A | B |\n|---|---|\n| 1 | 2 |";
    const result = convertMarkdownForDingTalk(input);
    // This is a valid table, should be wrapped
    expect(result).toContain("```");
  });

  it("handles empty input", () => {
    expect(convertMarkdownForDingTalk("")).toBe("");
  });

  it("preserves fenced code blocks while normalizing outer line breaks", () => {
    const input = `第一行
\`\`\`js
const a = 1;
const b = 2;
\`\`\`
第二行`;

    const result = convertMarkdownForDingTalk(input);

    expect(result).toContain("第一行  \n```js");
    expect(result).toContain("const a = 1;\nconst b = 2;");
    expect(result).not.toContain("const a = 1;  \n");
  });
});
