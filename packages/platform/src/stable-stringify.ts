/**
 * Deterministic JSON: objects serialize with sorted keys, recursively. For hashing only.
 * JSON semantics are honored: `toJSON` is respected (Date → ISO string); undefined/function/
 * symbol entries are dropped from objects and become `null` inside arrays. A root value that
 * is not JSON-serializable at all (undefined/function/symbol) throws instead of silently
 * producing a non-string.
 */
export function stableStringify(value: unknown): string {
  const out = encode(value);
  if (out === undefined) {
    throw new TypeError(`stableStringify: value is not JSON-serializable (${typeof value})`);
  }
  return out;
}

function encode(value: unknown): string | undefined {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { toJSON?: unknown }).toJSON === "function"
  ) {
    return encode((value as { toJSON: () => unknown }).toJSON());
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => encode(v) ?? "null").join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => [k, encode(v)] as const)
    .filter((pair): pair is readonly [string, string] => pair[1] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(",")}}`;
}
