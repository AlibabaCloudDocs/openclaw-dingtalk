/**
 * Derive a DingTalk Markdown message title from the message text.
 *
 * DingTalk mobile push notifications often use the markdown "title" as the preview,
 * so using a constant value (e.g. "Clawdbot") causes all notifications to look the same.
 */

export function deriveMarkdownTitle(text: string, opts: { fallback?: string; maxLen?: number } = {}): string {
  const fallback = (opts.fallback ?? "Clawdbot").trim() || "Clawdbot";
  const maxLen = Math.max(4, opts.maxLen ?? 40);

  const normalized = String(text ?? "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const raw = lines[i]?.trim();
    if (!raw) continue;
    if (raw.startsWith("```") || raw.startsWith("~~~")) continue;

    let title = raw;
    title = title.replace(/^#{1,6}\s+/, ""); // headings
    title = title.replace(/^>\s+/, ""); // blockquote
    title = title.replace(/^[-*+]\s+/, ""); // list item
    title = title.replace(/^\d+[.)]\s+/, ""); // ordered list item

    // Strip common inline markdown while keeping visible text.
    title = title.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
    title = title.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    title = title.replace(/`+/g, "");
    title = title.replace(/\*\*([^*]+)\*\*/g, "$1");
    title = title.replace(/\*([^*]+)\*/g, "$1");
    title = title.replace(/__([^_]+)__/g, "$1");
    title = title.replace(/_([^_]+)_/g, "$1");

    title = title.replace(/\s+/g, " ").trim();
    if (!title) continue;

    if (title.length > maxLen) {
      return title.slice(0, Math.max(0, maxLen - 3)).trimEnd() + "...";
    }
    return title;
  }

  return fallback;
}

