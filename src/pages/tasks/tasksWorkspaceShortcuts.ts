export function isTasksLeftNavToggleShortcut(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey" | "repeat">): boolean {
  if (event.repeat || event.ctrlKey || event.shiftKey) {
    return false;
  }
  const key = String(event.key ?? "").toLowerCase();
  const isBKey = key === "b" || event.code === "KeyB" || event.key === "ㅠ";
  return Boolean(event.metaKey && event.altKey && isBKey);
}
