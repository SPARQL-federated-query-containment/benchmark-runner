# benchmark-runner

Runs the federated SPARQL query containment benchmark against the decision
procedure and reports the outcomes and timings as JSON.

## Setup

Needs [Bun](https://bun.sh) and Docker (for the SpeCS set-containment oracle).

```sh
git submodule update --init --recursive   # solver, and solver/specs/SpeCS
bun install
bun run image                             # docker build -t specs solver/specs
```

`data/pairs` and `data/scale_pairs` are committed. To refresh them from the
generator:

```sh
(cd ../benchmark && make pairs) && cp -r ../benchmark/build/{pairs,scale_pairs} data/
```

## Running

```sh
bun run smoke                             # both engines, both suites, 1 repetition
bun run bench -- -r 10 -w 2               # 10 timed repetitions, 2 warmup rounds
bun run bench -- --suite scale -r 5       # scaling suite only
bun run bench -- --engine specs           # baseline only
bun run bench -- --filter '025|024'       # a subset by pair id
```

| flag | default | meaning |
|---|---|---|
| `-r, --repetitions <n>` | `1` | timed repetitions per pair |
| `-w, --warmup <n>` | `0` | discarded rounds after the engine starts |
| `--suite <correctness\|scale\|all>` | `all` | which pair set to run |
| `--engine <bfc\|specs\|both>` | `both` | see below |
| `--filter <regex>` | – | only pairs whose id matches |
| `--out <dir>` | `results/<timestamp>` | where the JSON files land |

## Engines

- **`bfc`** — the staged federated bag-set containment procedure (`solver`), which
  returns `contained` / `not contained` / `unknown`.
- **`specs`** — the bare SpeCS set-containment oracle on the same pairs, as a
  baseline. Two-valued; wrong wherever set and bag-set containment differ.

## Output

`results/<timestamp>/{bfc,specs}.{correctness,scale}.json`, one per engine ×
suite. Each carries its `meta` (environment, repetitions), a `summary`
(`meanMs` / `medianMs`, outcome counts with the offending ids, `bySize` for
scale), and a `results` map keyed by pair id:

```json
"007-service_S2-drop_head_variable": {
  "expected": "not contained",
  "verdict": "not contained",
  "outcome": "correct",
  "meanMs": 1.87,
  "medianMs": 1.9,
  "ms": [1.9, 1.8, 1.9]
}
```

`outcome` is `correct` · `incorrect` (a wrong definite verdict) · `unknown` (the
procedure declined, a valid answer on the open fragment) · `error`. Pair
metadata (operator, side, semantics) lives in `data/*/index.json`, joined on the
id.
