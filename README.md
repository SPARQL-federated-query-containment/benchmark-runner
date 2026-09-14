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

`data/pairs_<suite>` and `data/pairs_<suite>_scale` (`operators`, `star`,
`branching`, `ucfq`) are committed. To refresh them from the generator:

```sh
(cd ../benchmark && make pairs) && rm -rf data/pairs_* && cp -r ../benchmark/build/pairs_* data/
```

## Running

```sh
bun run smoke                                          # both engines, all suites, 2 repetitions
bun run bench -- --repetitions-correctness 10 -w 2     # 10 timed repetitions on correctness suites, 2 warmup rounds
bun run bench -- --suite scale --repetitions-scale 5   # the four scaling twins only
bun run bench -- --suite star                          # one suite
bun run bench -- --engine specs                        # baseline only
bun run bench -- --filter '025|024'                    # a subset by pair id
```

| flag | default | meaning |
|---|---|---|
| `--repetitions-correctness <n>` | `20` | timed repetitions per pair, correctness suites |
| `--repetitions-scale <n>` | `20` | timed repetitions per pair, scale suites |
| `-w, --warmup <n>` | `0` | discarded rounds after the engine starts |
| `--suite <suite>` | `all` | `operators` · `star` · `branching` · `ucfq` (append `-scale` for the twin), the groups `correctness` (the four base suites) and `scale` (the four twins), or `all` |
| `--engine <bfc\|specs\|both>` | `both` | see below |
| `--filter <regex>` | – | only pairs whose id matches |
| `--out <dir>` | `results/<timestamp>` | where the JSON files land |
| `-t, --timeout <ms>` | `1200000` (20 min) | per-pair budget; also piped to the SpeCS oracle as its z3 timeout, so the two stay in sync (LargeRDFBench's own convention for simple/complex queries) |
| `--memory <mb>` | `4096` | z3 virtual memory limit inside the SpeCS oracle |

A pair stops repeating as soon as one repetition errors, times out, runs out
of memory, or answers wrong — the same failure will recur, and a single one
is already enough to mark the pair against the engine. A 5s pause separates
repetitions otherwise, so a heavy repetition's memory has time to be freed
before the next one is timed.

## Engines

- **`bfc`** — the staged federated bag-set containment procedure (`solver`), which
  returns `contained` / `not contained` / `unknown`, or the oracle's own
  `timeout` / `set solver unknown` / `out of memory` when it has to consult
  SpeCS and SpeCS can't reach a verdict.
- **`specs`** — the bare SpeCS set-containment oracle on the same pairs, as a
  baseline. Two-valued when it answers at all; wrong wherever set and bag-set
  containment differ.

## Output

`results/<timestamp>/<engine>.<suite>.json`, one per engine × suite (e.g.
`bfc.star.json`, `specs.ucfq-scale.json`). Each carries its `meta` (environment,
repetitions, the `timeoutMs`/`memoryMb` the run used), a `summary` (`meanMs` /
`medianMs`, outcome counts with the offending ids, `bySize` for the scale
suites), and a `results` map keyed by pair
id:

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

`outcome` is `correct` · `incorrect` (a wrong definite verdict) · `unknown`
(the procedure declined, a valid answer on the open fragment) · `timeout` (the
z3 oracle hit its budget) · `set solver unknown` (z3 itself answered
inconclusive, not from running out of time) · `out of memory` (z3 hit its
memory limit) · `error` (an infrastructure failure, e.g. the container dying).

Only `timeout` carries no timing — it stopped because of the imposed budget,
not because a run actually finished, so `meanMs`/`medianMs`/`ms` are absent:

```json
"063-star_1000-relax_clause": {
  "expected": "contained",
  "verdict": "timeout",
  "outcome": "timeout"
}
```

Every other outcome, `set solver unknown` and `out of memory` included, keeps
its timing — those represent a real completed run, just an inconclusive or
resource-exhausted one.
