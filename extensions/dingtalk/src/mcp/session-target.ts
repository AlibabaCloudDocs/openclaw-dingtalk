function trimToken(value: string): string {
  return value.trim();
}

export function resolveDingTalkTargetFromSessionKey(sessionKey?: string): string | undefined {
  const raw = trimToken(sessionKey ?? "");
  if (!raw) {
    return undefined;
  }

  const dmMatch = raw.match(/dingtalk:dm:([^:\s]+)/i);
  if (dmMatch?.[1]) {
    return `dingtalk:dm:${dmMatch[1]}`;
  }

  const groupMatch = raw.match(/dingtalk:group:([^:\s]+)/i);
  if (groupMatch?.[1]) {
    return `dingtalk:group:${groupMatch[1]}`;
  }

  return undefined;
}

