import {
  type SafePromise,
  type Result,
  result,
  error,
  isError,
} from "result-interface";
import type { Pair, Verdict } from "./load";
import type { Decision, Engine, DecisionVerdict } from "./engines";
import { mean, median } from "./stats";

const SETTLE_DELAY_MS = 5000;

function timeoutAfter(ms: number): Promise<Result<Decision>> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(result({ verdict: "timeout" })), ms);
  });
}

export type Outcome =
  | "correct"
  | "incorrect"
  | "unknown"
  | "timeout"
  | "set solver unknown"
  | "out of memory"
  | "error";

export interface TimedResult {
  expected: Verdict;
  verdict: Exclude<DecisionVerdict, "timeout">;
  outcome: Exclude<Outcome, "timeout" | "error">;
  meanMs: number;
  medianMs: number;
  ms: number[];
}

export interface TimedOutResult {
  expected: Verdict;
  verdict: "timeout";
  outcome: "timeout";
}

export interface ErroredResult {
  expected: Verdict;
  verdict: "error";
  outcome: "error";
  reason: string;
}

export type PairResult = TimedResult | TimedOutResult | ErroredResult;

interface Accumulator {
  verdicts: DecisionVerdict[];
  ms: number[];
  reason?: string;
}

/** No point repeating a pair once it has errored, timed out, run out of
 * memory, or already answered wrong — the same failure will recur. */
function isSettled(acc: Accumulator, expected: Verdict): boolean {
  if (acc.reason !== undefined) {
    return true;
  }

  const last = acc.verdicts.at(-1);
  if (last === undefined) {
    return false;
  }

  if (last === "timeout" || last === "out of memory") {
    return true;
  }

  return (last === "contained" || last === "not contained") && last !== expected;
}

function outcomeOf(
  expected: Verdict,
  verdict: Exclude<DecisionVerdict, "timeout">,
): Exclude<Outcome, "timeout" | "error"> {
  if (
    verdict === "unknown" ||
    verdict === "set solver unknown" ||
    verdict === "out of memory"
  ) {
    return verdict;
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
  if (verdict === "timeout") {
    return result({ expected, verdict: "timeout", outcome: "timeout" });
  }

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
  timeoutMs?: number,
): SafePromise<Map<string, PairResult>> {
  const accumulators = new Map<string, Accumulator>(
    pairs.map((pair) => [pair.meta.id, { verdicts: [], ms: [] }]),
  );

  for (let pass = 0; pass < repetitions; pass += 1) {
    for (const pair of pairs) {
      const acc = accumulators.get(pair.meta.id)!;
      if (isSettled(acc, pair.meta.expected)) {
        continue;
      }

      const start = performance.now();
      const decision =
        timeoutMs === undefined
          ? await engine.decide(pair)
          : await Promise.race([engine.decide(pair), timeoutAfter(timeoutMs)]);
      const elapsed = performance.now() - start;

      if (isError(decision)) {
        acc.reason = decision.error.message;
        continue;
      }

      acc.verdicts.push(decision.value.verdict);
      if (decision.value.verdict !== "timeout") {
        acc.ms.push(elapsed);
      }
    }

    if (pass < repetitions - 1) {
      await Bun.sleep(SETTLE_DELAY_MS);
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
