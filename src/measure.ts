import {
  type SafePromise,
  type Result,
  result,
  error,
  isError,
} from "result-interface";
import type { Pair, Verdict } from "./load";
import type { Engine } from "./engines";
import { mean, median } from "./stats";

export type Outcome = "correct" | "incorrect" | "unknown" | "error";

export interface PairResult {
  expected: Verdict;
  verdict: Verdict | "unknown" | "error";
  outcome: Outcome;
  verdictStable?: false;
  meanMs?: number;
  medianMs?: number;
  ms?: number[];
  reason?: string;
}

interface Accumulator {
  verdicts: (Verdict | "unknown")[];
  ms: number[];
  reason?: string;
}

function outcomeOf(
  expected: Verdict,
  verdict: Verdict | "unknown" | "error",
): Outcome {
  if (verdict === "error") {
    return "error";
  }
  if (verdict === "unknown") {
    return "unknown";
  }
  return verdict === expected ? "correct" : "incorrect";
}

function finalize(expected: Verdict, acc: Accumulator): Result<PairResult> {
  if (acc.reason !== undefined) {
    return result({
      expected,
      verdict: "error",
      outcome: "error",
      reason: acc.reason,
    });
  }

  const verdict = acc.verdicts[0]!;
  const stable = acc.verdicts.every((value) => value === verdict);

  const meanMs = mean(acc.ms);
  if (isError(meanMs)) {
    return meanMs;
  }

  const medianMs = median(acc.ms);
  if (isError(medianMs)) {
    return medianMs;
  }

  return result({
    expected,
    verdict,
    outcome: outcomeOf(expected, verdict),
    ...(stable ? {} : { verdictStable: false as const }),
    meanMs: meanMs.value,
    medianMs: medianMs.value,
    ms: acc.ms,
  });
}

export async function warmUp(
  engine: Engine,
  pair: Pair,
  rounds: number,
): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await engine.decide(pair);
  }
}

export async function measure(
  engine: Engine,
  pairs: Pair[],
  repetitions: number,
): SafePromise<Map<string, PairResult>> {
  const accumulators = new Map<string, Accumulator>(
    pairs.map((pair) => [pair.meta.id, { verdicts: [], ms: [] }]),
  );

  for (let pass = 0; pass < repetitions; pass += 1) {
    for (const pair of pairs) {
      const acc = accumulators.get(pair.meta.id)!;
      if (acc.reason !== undefined) {
        continue;
      }

      const start = performance.now();
      const decision = await engine.decide(pair);
      const elapsed = performance.now() - start;

      if (isError(decision)) {
        acc.reason = decision.error.message;
        continue;
      }

      acc.verdicts.push(decision.value.verdict);
      acc.ms.push(elapsed);
    }
  }

  const results = new Map<string, PairResult>();
  for (const pair of pairs) {
    const finalized = finalize(
      pair.meta.expected,
      accumulators.get(pair.meta.id)!,
    );
    if (isError(finalized)) {
      return error(new Error(`${pair.meta.id}: ${finalized.error.message}`));
    }
    results.set(pair.meta.id, finalized.value);
  }

  return result(results);
}
