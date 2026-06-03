// Generic context-layer utilities. Extracted from contextPacket.ts (god-module split, Phase C).
export function unique<T>(values: T[]) {
  return [...new Set(values.filter(Boolean))];
}
