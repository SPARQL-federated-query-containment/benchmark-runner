import { join } from "node:path";
import { type SafePromise, result, error } from "result-interface";

export type Verdict = "contained" | "not contained";
export type Semantics = "bag-set" | "bag";
export type Side = "sub" | "super" | "both";

export interface SideMeta {
  semantics: Semantics;
  federation?: string[];
}

export interface PairMeta {
  id: string;
  suite?: string;
  query: string;
  operator: string;
  side: Side;
  expected: Verdict;
  sub: SideMeta;
  super: SideMeta;
  files: { sub: string; super: string };
}

export interface Pair {
  meta: PairMeta;
  subQueryPath: string;
  superQueryPath: string;
  size?: number;
}

function sizeOf(query: string): number | undefined {
  const match = /_(\d+)$/.exec(query);
  return match ? Number(match[1]) : undefined;
}

export async function load(directory: string): SafePromise<Pair[]> {
  const indexFile = Bun.file(join(directory, "metadata.json"));

  if (!(await indexFile.exists())) {
    return error(
      new Error(
        `${directory}/metadata.json is missing — copy it from ../benchmark/build`,
      ),
    );
  }

  const index = (await indexFile.json()) as { pairs: PairMeta[] };

  const pairs: Pair[] = index.pairs.map((meta) => ({
    meta,
    subQueryPath: join(directory, meta.files.sub),
    superQueryPath: join(directory, meta.files.super),
    size: sizeOf(meta.query),
  }));

  return result(pairs);
}
