import { test, expect } from "bun:test";
import { isError } from "result-interface";
import { isSettled, finalize, outcomeOf, type Accumulator } from "../src/measure";

function acc(verdicts: Accumulator["verdicts"], ms: number[] = [], reason?: string): Accumulator {
  return { verdicts, ms, reason };
}

test("isSettled: an empty accumulator has not settled", () => {
  expect(isSettled(acc([]), "contained")).toBe(false);
});

test("isSettled: a matching contained/not-contained verdict keeps repeating", () => {
  expect(isSettled(acc(["contained"]), "contained")).toBe(false);
  expect(isSettled(acc(["not contained"]), "not contained")).toBe(false);
});

test("isSettled: unknown keeps repeating", () => {
  expect(isSettled(acc(["unknown"]), "contained")).toBe(false);
});

test("isSettled: a mismatched contained/not-contained verdict settles", () => {
  expect(isSettled(acc(["not contained"]), "contained")).toBe(true);
});

test("isSettled: timeout settles", () => {
  expect(isSettled(acc(["contained", "contained", "timeout"]), "contained")).toBe(true);
});

test("isSettled: out of memory settles", () => {
  expect(isSettled(acc(["out of memory"]), "contained")).toBe(true);
});

test("isSettled: a recorded error settles regardless of verdicts", () => {
  expect(isSettled(acc([], [], "boom"), "contained")).toBe(true);
});

test("outcomeOf: a matching verdict is correct", () => {
  expect(outcomeOf("contained", "contained")).toBe("correct");
});

test("outcomeOf: a mismatched verdict is incorrect", () => {
  expect(outcomeOf("contained", "not contained")).toBe("incorrect");
});

test("outcomeOf: unknown and out of memory pass through as themselves", () => {
  expect(outcomeOf("contained", "unknown")).toBe("unknown");
  expect(outcomeOf("contained", "out of memory")).toBe("out of memory");
});

test("finalize: reports the recorded error", () => {
  const finalized = finalize("contained", acc([], [], "boom"));
  expect(finalized).toEqual({
    value: { expected: "contained", verdict: "error", outcome: "error", reason: "boom" },
  });
});

test("finalize: a pair that only ever timed out is reported as timeout", () => {
  const finalized = finalize("contained", acc(["timeout"]));
  expect(finalized).toEqual({
    value: { expected: "contained", verdict: "timeout", outcome: "timeout" },
  });
});

test("finalize: a pair correct on every repetition is reported as correct", () => {
  const finalized = finalize("contained", acc(["contained", "contained", "contained"], [10, 20, 30]));
  expect(isError(finalized)).toBe(false);
  if (!isError(finalized)) {
    expect(finalized.value.verdict).toBe("contained");
    expect(finalized.value.outcome).toBe("correct");
  }
});

test("finalize: a pair that succeeds several times then times out is reported as timeout, not its earlier successes", () => {
  const finalized = finalize("contained", acc(["contained", "contained", "contained", "timeout"], [10, 20, 30]));
  expect(finalized).toEqual({
    value: { expected: "contained", verdict: "timeout", outcome: "timeout" },
  });
});

test("finalize: a pair that succeeds several times then answers wrong is reported as incorrect", () => {
  const finalized = finalize(
    "contained",
    acc(["contained", "contained", "not contained"], [10, 20, 30]),
  );
  expect(isError(finalized)).toBe(false);
  if (!isError(finalized)) {
    expect(finalized.value.verdict).toBe("not contained");
    expect(finalized.value.outcome).toBe("incorrect");
  }
});

test("finalize: reports an error when called on a pair with no recorded verdict", () => {
  expect(isError(finalize("contained", acc([])))).toBe(true);
});
