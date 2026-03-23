function randomHex(length: number): string {
  const normalizedLength = Math.max(2, Math.floor(length));
  const byteCount = Math.ceil(normalizedLength / 2);
  const bytes = new Uint8Array(byteCount);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("").slice(0, normalizedLength);
}

export function createRandomIdSuffix(length = 8): string {
  const uuid = globalThis.crypto.randomUUID().replace(/-/g, "");
  if (uuid.length >= length) {
    return uuid.slice(0, length);
  }
  return `${uuid}${randomHex(length - uuid.length)}`.slice(0, length);
}
