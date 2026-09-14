import { type SafePromise, result } from "result-interface";
import type { ContainmentResult } from "solver/lib/containment_solver";
import type { Pair } from "./load";
import { startWorkerEngine } from "./bfc_worker_client";

export type EngineName = "bfc" | "specs";

export interface Decision {
  verdict: ContainmentResult;
}

export interface Engine {
  name: EngineName;
  decide(pair: Pair): SafePromise<Decision>;
}

export async function startEngines(
  names: EngineName[],
  timeoutMs: number,
  z3TimeoutSeconds?: number,
  z3MemoryMb?: number,
): SafePromise<{ engines: Engine[]; close: () => Promise<void> }> {
  const closers: (() => Promise<void>)[] = [];
  const engines: Engine[] = [];

  for (const name of names) {
    const { engine, close } = startWorkerEngine(
      name,
      timeoutMs,
      z3TimeoutSeconds,
      z3MemoryMb,
    );
    closers.push(close);
    engines.push(engine);
  }

  return result({
    engines,
    close: async () => {
      for (const close of closers) {
        await close();
      }
    },
  });
}
