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

  it("repairs collapsed inline heading markers around paragraph boundaries", () => {
    const input =
      "根据搜索结果，我找到了一些AI领域的优质聚合网站和RSS订阅源。让我为你整理一下：## AI领域优质聚合网站及RSS源### 1. ArXiv AI 论文";

    const result = convertMarkdownForDingTalk(input);

    expect(result).toContain("让我为你整理一下：\n\n## AI领域优质聚合网站及RSS源");
    expect(result).toContain("AI领域优质聚合网站及RSS源\n\n### 1. ArXiv AI 论文");
  });

  it("repairs collapsed heading and paragraph at section end", () => {
    const input = "## 订阅建议你可以使用以下RSS阅读器来订阅这些源：";

    const result = convertMarkdownForDingTalk(input);

    expect(result).toContain("## 订阅建议\n\n你可以使用以下RSS阅读器来订阅这些源：");
  });

  it("splits trailing question into a separate paragraph", () => {
    const input =
      "- Inoreader 或 Feedly: 在线RSS服务要订阅这些RSS源，只需将对应的RSS链接添加到你的RSS阅读器中即可。这样你就能在一个地方集中获取所有AI领域的最新资讯了！需要我帮你设置具体的RSS阅读器或者有其他问题吗？";

    const result = convertMarkdownForDingTalk(input);

    expect(result).toContain("最新资讯了！\n\n需要我帮你设置具体的RSS阅读器或者有其他问题吗？");
  });
});
