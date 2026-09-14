import { $ } from "bun";
import os from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { isError } from "result-interface";
import { mean, median } from "./stats";
import type { Pair } from "./load";
import type { PairResult } from "./measure";
import type { EngineName } from "./engines";

export interface Env {
  platform: string;
  cpu: string;
  cpuCount: number;
  memBytes: number;
  bun: string;
  docker: string;
  specsImageId: string;
  z3: string;
}

async function line(command: Promise<{ text(): string }>): Promise<string> {
  try {
    return (await command).text().trim();
  } catch {
    return "unknown";
  }
}

const IMAGE = "specs";

export async function captureEnv(): Promise<Env> {
  const cpus = os.cpus();
  return {
    platform: os.platform(),
    cpu: cpus[0]?.model ?? "unknown",
    cpuCount: cpus.length,
    memBytes: os.totalmem(),
    bun: Bun.version,
    docker: await line($`docker --version`.quiet().nothrow()),
    specsImageId: await line(
      $`docker image inspect ${IMAGE} --format {{.Id}}`.quiet().nothrow(),
    ),
    z3: await line(
      $`docker run --rm --entrypoint z3 ${IMAGE} --version`.quiet().nothrow(),
    ),
  };
}

interface Bucket {
  count: number;
  ids: string[];
}

interface Aggregate {
  meanMs: number;
  medianMs: number;
}

interface Summary extends Partial<Aggregate> {
  total: number;
  correct: number;
  incorrect: Bucket;
  unknown: Bucket;
  timeout: Bucket;
  outOfMemory: Bucket;
  error: Bucket;
  bySize?: Record<string, Partial<Aggregate>>;
}

export interface RunContext {
  engine: EngineName;
  suite: string;
  startedAt: string;
  finishedAt: string;
  repetitions: number;
  warmup: number;
  timeoutMs: number;
  memoryMb: number;
  env: Env;
}

interface OutFile {
  meta: RunContext;
  summary: Summary;
  results: Record<string, PairResult>;
}

function aggregate(samples: number[]): Partial<Aggregate> {
  const meanMs = mean(samples);
  const medianMs = median(samples);
  return {
    ...(isError(meanMs) ? {} : { meanMs: meanMs.value }),
    ...(isError(medianMs) ? {} : { medianMs: medianMs.value }),
  };
}

function summarize(pairs: Pair[], results: Map<string, PairResult>): Summary {
  const incorrect: Bucket = { count: 0, ids: [] };
  const unknown: Bucket = { count: 0, ids: [] };
  const timeout: Bucket = { count: 0, ids: [] };
  const outOfMemory: Bucket = { count: 0, ids: [] };
  const failed: Bucket = { count: 0, ids: [] };
  let correct = 0;

  const all: number[] = [];
  const bySize = new Map<number, number[]>();

  for (const pair of pairs) {
    const entry = results.get(pair.meta.id)!;
    const id = pair.meta.id;

    switch (entry.outcome) {
      case "correct":
        correct += 1;
        break;
      case "incorrect":
        incorrect.count += 1;
        incorrect.ids.push(id);
        break;
      case "unknown":
        unknown.count += 1;
        unknown.ids.push(id);
        break;
      case "timeout":
        timeout.count += 1;
        timeout.ids.push(id);
        break;
      case "out of memory":
        outOfMemory.count += 1;
        outOfMemory.ids.push(id);
        break;
      case "error":
        failed.count += 1;
        failed.ids.push(id);
        break;
    }

    if (entry.outcome !== "timeout" && entry.outcome !== "error") {
      all.push(...entry.ms);
      if (pair.size !== undefined) {
        const samples = bySize.get(pair.size) ?? [];
        samples.push(...entry.ms);
        bySize.set(pair.size, samples);
      }
    }
  }

  const summary: Summary = {
    ...aggregate(all),
    total: pairs.length,
    correct,
    incorrect,
    unknown,
    timeout,
    outOfMemory,
    error: failed,
  };

  if (bySize.size > 0) {
    summary.bySize = Object.fromEntries(
      [...bySize.entries()]
        .sort(([a], [b]) => a - b)
        .map(([size, samples]) => [String(size), aggregate(samples)]),
    );
  }

  return summary;
}

export function reportPath(outDir: string, engine: EngineName, suite: string): string {
  return join(outDir, `${engine}.${suite}.json`);
}

export async function writeReport(
  outDir: string,
  context: RunContext,
  pairs: Pair[],
  results: Map<string, PairResult>,
): Promise<string> {
  await mkdir(outDir, { recursive: true });

  const file: OutFile = {
    meta: context,
    summary: summarize(pairs, results),
    results: Object.fromEntries(
      pairs.map((pair) => [pair.meta.id, results.get(pair.meta.id)!]),
    ),
  };

  const path = reportPath(outDir, context.engine, context.suite);
  await Bun.write(path, JSON.stringify(file, null, 2) + "\n");
  return path;
}
