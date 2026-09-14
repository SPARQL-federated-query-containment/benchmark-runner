import { type SafePromise, result, error } from "result-interface";
import type { ContainmentResult } from "solver/lib/containment_solver";
import type { Pair } from "./load";
import type { Decision, Engine, EngineName } from "./engines";

const CONTAINMENT_RESULTS = new Set<ContainmentResult>([
  "contained",
  "not contained",
  "unknown",
  "timeout",
  "out of memory",
]);

interface ResultMessage {
  requestId: number;
  type: "result";
  value: string;
}

interface ErrorMessage {
  requestId: number;
  type: "error";
  message: string;
}

export function startWorkerEngine(
  name: EngineName,
  timeoutMs: number,
  z3TimeoutSeconds?: number,
  z3MemoryMb?: number,
): { engine: Engine; close: () => Promise<void> } {
  const worker = new Worker(new URL("./bfc_worker.ts", import.meta.url).href);
  let nextRequestId = 0;

  function decide(pair: Pair): SafePromise<Decision> {
    const requestId = nextRequestId++;

    return new Promise((resolve) => {
      worker.onmessage = (event: MessageEvent<ResultMessage | ErrorMessage>) => {
        const msg = event.data;
        if (msg.requestId !== requestId) {
          return;
        }

        if (msg.type === "error") {
          resolve(error(new Error(msg.message)));
          return;
        }

        if (!CONTAINMENT_RESULTS.has(msg.value as ContainmentResult)) {
          resolve(error(new Error(`unrecognised verdict from solver: "${msg.value}"`)));
          return;
        }

        resolve(result({ verdict: msg.value as ContainmentResult }));
      };
      worker.postMessage({
        requestId,
        engine: name,
        pair,
        timeoutMs,
        z3TimeoutSeconds,
        z3MemoryMb,
      });
    });
  }

  return {
    engine: { name, decide },
    close: () => Promise.resolve(worker.terminate()).then(() => undefined),
  };
}
