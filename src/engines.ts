import {
  type SafePromise,
  type Result,
  result,
  error,
  isError,
} from "result-interface";
import { locate } from "solver/lib/located_query";
import { decideSetContainment } from "solver/lib/federated_containment";
import { decideUcfqContainment } from "solver/lib/ucfq_containment";
import { startSpecs } from "solver/lib/specs";
import type { SetSolver } from "solver/lib/SetContainmentSolver";
import type { LocatedQuery } from "solver/lib/containment_mapping";
import type { Pair, Verdict } from "./load";

export type EngineName = "bfc" | "specs";

export interface Decision {
  verdict: Verdict | "unknown";
}

export interface Engine {
  name: EngineName;
  decide(pair: Pair): SafePromise<Decision>;
}

interface Located {
  sub: LocatedQuery;
  super: LocatedQuery;
}

function locatePair(pair: Pair): Result<Located> {
  const sub = locate(pair.subText);
  if (isError(sub)) {
    return error(new Error(`sub: ${sub.error.message}`));
  }

  const superQuery = locate(pair.superText);
  if (isError(superQuery)) {
    return error(new Error(`super: ${superQuery.error.message}`));
  }

  if (sub.value.semantics !== pair.meta.sub.semantics) {
    return error(
      new Error(
        `sub semantics ${sub.value.semantics} does not match meta ${pair.meta.sub.semantics}`,
      ),
    );
  }

  if (superQuery.value.semantics !== pair.meta.super.semantics) {
    return error(
      new Error(
        `super semantics ${superQuery.value.semantics} does not match meta ${pair.meta.super.semantics}`,
      ),
    );
  }

  return result({ sub: sub.value, super: superQuery.value });
}

function bfcEngine(solver: SetSolver): Engine {
  return {
    name: "bfc",
    decide: async (pair) => {
      const located = locatePair(pair);
      if (isError(located)) {
        return located;
      }

      const { sub, super: superQuery } = located.value;
      const decide =
        sub.semantics === "bag" || superQuery.semantics === "bag"
          ? decideUcfqContainment
          : decideSetContainment;

      const containment = await decide(sub, superQuery, solver.isContained);
      if (isError(containment)) {
        return containment;
      }

      return result({ verdict: containment.value });
    },
  };
}

function specsEngine(solver: SetSolver): Engine {
  return {
    name: "specs",
    decide: async (pair) => {
      const located = locatePair(pair);
      if (isError(located)) {
        return located;
      }

      const contained = await solver.isContained(
        located.value.sub,
        located.value.super,
      );
      if (isError(contained)) {
        return contained;
      }

      return result({
        verdict: contained.value ? "contained" : "not contained",
      });
    },
  };
}

export async function startEngines(
  names: EngineName[],
  image = "specs",
): SafePromise<{ engines: Engine[]; close: () => Promise<void> }> {
  const started = await startSpecs(image);
  if (isError(started)) {
    return started;
  }

  const solver = started.value;
  const build: Record<EngineName, () => Engine> = {
    bfc: () => bfcEngine(solver),
    specs: () => specsEngine(solver),
  };

  return result({
    engines: names.map((name) => build[name]()),
    close: () => solver.close(),
  });
}
