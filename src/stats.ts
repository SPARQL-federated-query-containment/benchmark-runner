import { type Result, result, error } from "result-interface";

export function mean(values: number[]): Result<number> {
  if (values.length === 0) {
    return error(new Error("mean of an empty list"));
  }
  return result(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function median(values: number[]): Result<number> {
  if (values.length === 0) {
    return error(new Error("median of an empty list"));
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return result(
    sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!,
  );
}
