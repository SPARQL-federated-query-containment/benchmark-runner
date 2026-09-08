import { join } from "node:path";
import { program } from "commander";
import { isError } from "result-interface";
import { load, type Pair } from "./load";
import { startEngines, type EngineName } from "./engines";
import { measure, warmUp } from "./measure";
import { captureEnv, writeReport } from "./report";

const SUITES: Record<string, string> = {
  correctness: "data/pairs",
  scale: "data/scale_pairs",
};

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
  .option("--suite <suite>", "correctness | scale | all", "all")
  .option("--engine <engine>", "bfc | specs | both", "both")
  .option("--filter <regex>", "only pairs whose id matches")
  .option("--out <dir>", "run directory (default results/<timestamp>)");

program.parse();

const options = program.opts<{
  repetitions: number;
  warmup: number;
  suite: string;
  engine: string;
  filter?: string;
  out?: string;
}>();

const suiteNames =
  options.suite === "all" ? Object.keys(SUITES) : [options.suite];
for (const name of suiteNames) {
  if (SUITES[name] === undefined) {
    console.error(`unknown suite "${name}"`);
    process.exit(2);
  }
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

const started = await startEngines(engineNames);
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
    const results = await measure(engine, suite.pairs, options.repetitions);
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
        `  ${count("incorrect")} incorrect  ${count("unknown")} unknown  ${count("error")} error`,
    );
  }
}

await close();

process.exit(failed ? 1 : 0);
