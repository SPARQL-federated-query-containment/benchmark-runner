import { join } from "node:path";
import { program } from "commander";
import { isError } from "result-interface";
import { load, type Pair } from "./load";
import { startEngines, type EngineName } from "./engines";
import { measure, warmUp } from "./measure";
import { captureEnv, writeReport } from "./report";

const CORRECTNESS = ["operators", "star", "branching", "ucfq"];
const SCALE = CORRECTNESS.map((suite) => `${suite}-scale`);

const SUITES: Record<string, string> = Object.fromEntries([
  ...CORRECTNESS.map((suite) => [suite, `data/pairs_${suite}`]),
  ...SCALE.map((suite) => [suite, `data/pairs_${suite.replace("-scale", "")}_scale`]),
]);

const GROUPS: Record<string, string[]> = {
  correctness: CORRECTNESS,
  scale: SCALE,
  all: Object.keys(SUITES),
};

const resolveSuites = (name: string): string[] | undefined =>
  GROUPS[name] ?? (SUITES[name] !== undefined ? [name] : undefined);

const anInteger = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`expected a non-negative integer, got "${value}"`);
  }
  return parsed;
};

program
  .description("Run the federated query containment benchmark.")
  .option("-r, --repetitions <n>", "timed repetitions per pair", anInteger, 1)
  .option("-w, --warmup <n>", "warmup rounds after the engine starts", anInteger, 0)
  .option(
    "--suite <suite>",
    "operators | star | branching | ucfq (append -scale for the twin) | correctness | scale | all",
    "all",
  )
  .option("--engine <engine>", "bfc | specs | both", "both")
  .option("--filter <regex>", "only pairs whose id matches")
  .option("--out <dir>", "run directory (default results/<timestamp>)")
  .option(
    "-t, --timeout <ms>",
    "per-pair timeout, also piped to the SpeCS oracle as its z3 budget",
    anInteger,
    1_200_000,
  )
  .option(
    "--memory <mb>",
    "z3 virtual memory limit inside the SpeCS oracle",
    anInteger,
    4096,
  );

program.parse();

const options = program.opts<{
  repetitions: number;
  warmup: number;
  suite: string;
  engine: string;
  filter?: string;
  out?: string;
  timeout: number;
  memory: number;
}>();

const suiteNames = resolveSuites(options.suite);
if (suiteNames === undefined) {
  console.error(`unknown suite "${options.suite}"`);
  process.exit(2);
}

const engineNames: EngineName[] =
  options.engine === "both" ? ["bfc", "specs"] : [options.engine as EngineName];
for (const name of engineNames) {
  if (name !== "bfc" && name !== "specs") {
    console.error(`unknown engine "${name}"`);
    process.exit(2);
  }
}

const filter = options.filter ? new RegExp(options.filter) : undefined;

const loaded: { name: string; pairs: Pair[] }[] = [];
for (const name of suiteNames) {
  const pairs = await load(SUITES[name]!);
  if (isError(pairs)) {
    console.error(pairs.error.message);
    process.exit(2);
  }
  const kept = filter
    ? pairs.value.filter((pair) => filter.test(pair.meta.id))
    : pairs.value;
  if (kept.length === 0) {
    console.error(`suite "${name}" has no pairs after --filter`);
    process.exit(2);
  }
  loaded.push({ name, pairs: kept });
}

const started = await startEngines(
  engineNames,
  "specs",
  Math.ceil(options.timeout / 1000),
  options.memory,
);
if (isError(started)) {
  console.error(started.error.message);
  process.exit(1);
}
const { engines, close } = started.value;

const warmupPair = loaded[0]!.pairs[0]!;
for (const engine of engines) {
  await warmUp(engine, warmupPair, options.warmup);
}

const env = await captureEnv();
const runDir =
  options.out ??
  join("results", new Date().toISOString().replace(/[:.]/g, "-"));

let failed = false;
for (const suite of loaded) {
  for (const engine of engines) {
    const startedAt = new Date().toISOString();
    const results = await measure(
      engine,
      suite.pairs,
      options.repetitions,
      options.timeout,
    );
    const finishedAt = new Date().toISOString();

    if (isError(results)) {
      console.error(`${engine.name}/${suite.name}: ${results.error.message}`);
      failed = true;
      continue;
    }

    const path = await writeReport(
      runDir,
      {
        engine: engine.name,
        suite: suite.name,
        startedAt,
        finishedAt,
        repetitions: options.repetitions,
        warmup: options.warmup,
        env,
      },
      suite.pairs,
      results.value,
    );

    const rows = [...results.value.values()];
    const count = (outcome: string) =>
      rows.filter((row) => row.outcome === outcome).length;
    console.log(
      `${path}  ${count("correct")}/${rows.length} correct` +
        `  ${count("incorrect")} incorrect  ${count("unknown")} unknown` +
        `  ${count("timeout")} timeout  ${count("set solver unknown")} solver unknown` +
        `  ${count("out of memory")} out of memory  ${count("error")} error`,
    );
  }
}

await close();

process.exit(failed ? 1 : 0);
