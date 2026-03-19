export function rememberThreadSelection(
  current: Record<string, string>,
  threadId: string,
  value: string,
): Record<string, string> {
  const normalizedThreadId = String(threadId ?? "").trim();
  if (!normalizedThreadId) {
    return current;
  }
  const normalizedValue = String(value ?? "").trim();
  if (!normalizedValue) {
    if (!(normalizedThreadId in current)) {
      return current;
    }
    const next = { ...current };
    delete next[normalizedThreadId];
    return next;
  }
  if (current[normalizedThreadId] === normalizedValue) {
    return current;
  }
  return {
    ...current,
    [normalizedThreadId]: normalizedValue,
  };
}

export function resolveThreadSelection(
  current: Record<string, string>,
  threadId: string,
  availableValues: string[],
  fallbackValue: string,
): string {
  const normalizedThreadId = String(threadId ?? "").trim();
  const remembered = normalizedThreadId ? String(current[normalizedThreadId] ?? "").trim() : "";
  if (remembered && availableValues.includes(remembered)) {
    return remembered;
  }
  return String(fallbackValue ?? "").trim();
}
