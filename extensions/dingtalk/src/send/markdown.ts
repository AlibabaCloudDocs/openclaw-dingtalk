/**
 * Markdown table conversion for DingTalk.
 * DingTalk's markdown renderer doesn't support tables well,
 * so we convert them to code blocks.
 */

export interface MarkdownOptions {
  tableMode?: "code" | "off";
}

function normalizeMarkdownStructureOutsideFences(text: string): string {
  if (!text) return "";

  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const output: string[] = [];
  let fenceChar: "`" | "~" | null = null;
  let fenceLength = 0;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const markerChar = marker[0] as "`" | "~";
      if (!fenceChar) {
        fenceChar = markerChar;
        fenceLength = marker.length;
      } else if (fenceChar === markerChar && marker.length >= fenceLength) {
        fenceChar = null;
        fenceLength = 0;
      }
      output.push(line);
      continue;
    }

    if (fenceChar) {
      output.push(line);
      continue;
    }

    let repaired = line;

    // Repair collapsed inline headings like "整理一下：## 标题" and "标题### 1. 小节".
    repaired = repaired.replace(/([：:。！？!?；;])\s*(?=#{2,6}\s)/g, "$1\n\n");
    repaired = repaired.replace(/([^\n\s#])(?=#{2,6}\s)/g, "$1\n\n");

    // Repair collapsed heading+body like "## 订阅建议你可以使用...".
    repaired = repaired.replace(
      /^(#{1,6}\s*[^\n#]{2,14}?)(?=(你可以|可以|请|如果|为了|需要|接下来|You can|Please|If\s))/u,
      "$1\n\n"
    );

    // Split closing question out of list/body tail when it gets appended.
    repaired = repaired.replace(/([。！？!?])(?=(需要我|如果你|还想|你也可以))/g, "$1\n\n");

    output.push(repaired);
  }

  return output.join("\n");
}

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

function hasHardBreakSuffix(line: string): boolean {
  return /(?:\s{2}|<br\s*\/?>)\s*$/i.test(line);
}

function applyHardLineBreaksOutsideFences(text: string): string {
  if (!text) return "";

  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const output: string[] = [];
  let fenceChar: "`" | "~" | null = null;
  let fenceLength = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    const nextLine = i + 1 < lines.length ? lines[i + 1] : undefined;

    if (fenceMatch) {
      const marker = fenceMatch[1];
      const markerChar = marker[0] as "`" | "~";
      if (!fenceChar) {
        fenceChar = markerChar;
        fenceLength = marker.length;
      } else if (fenceChar === markerChar && marker.length >= fenceLength) {
        fenceChar = null;
        fenceLength = 0;
      }
      output.push(line);
      continue;
    }

    const inFence = fenceChar !== null;
    const shouldApplyHardBreak =
      !inFence &&
      nextLine !== undefined &&
      !isBlankLine(line) &&
      !isBlankLine(nextLine) &&
      !hasHardBreakSuffix(line);

    output.push(shouldApplyHardBreak ? `${line}  ` : line);
  }

  return output.join("\n");
}

/**
 * Convert markdown tables to code blocks for DingTalk compatibility.
 */
export function convertMarkdownForDingTalk(text: string, options: MarkdownOptions = {}): string {
  const tableMode = options.tableMode ?? "code";
  const repaired = normalizeMarkdownStructureOutsideFences(text);
  if (tableMode === "off") {
    return applyHardLineBreaksOutsideFences(repaired);
  }

  const lines = repaired.split("\n");
  let inTable = false;
  let tableLines: string[] = [];
  const result: string[] = [];

  for (const line of lines) {
    const isTableLine = line.trim().startsWith("|") && line.includes("|");

    if (isTableLine) {
      if (!inTable) {
        inTable = true;
        tableLines = [];
      }
      tableLines.push(line);
    } else {
      if (inTable) {
        result.push("```");
        result.push(...tableLines);
        result.push("```");
        tableLines = [];
        inTable = false;
      }
      result.push(line);
    }
  }

  if (inTable) {
    result.push("```");
    result.push(...tableLines);
    result.push("```");
  }

  return applyHardLineBreaksOutsideFences(result.join("\n"));
}
