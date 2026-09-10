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
bun run smoke                             # both engines, all suites, 1 repetition
bun run bench -- -r 10 -w 2               # 10 timed repetitions, 2 warmup rounds
bun run bench -- --suite scale -r 5       # the four scaling twins only
bun run bench -- --suite star             # one suite
bun run bench -- --engine specs           # baseline only
bun run bench -- --filter '025|024'       # a subset by pair id
```

| flag | default | meaning |
|---|---|---|
| `-r, --repetitions <n>` | `1` | timed repetitions per pair |
| `-w, --warmup <n>` | `0` | discarded rounds after the engine starts |
| `--suite <suite>` | `all` | `operators` · `star` · `branching` · `ucfq` (append `-scale` for the twin), the groups `correctness` (the four base suites) and `scale` (the four twins), or `all` |
| `--engine <bfc\|specs\|both>` | `both` | see below |
| `--filter <regex>` | – | only pairs whose id matches |
| `--out <dir>` | `results/<timestamp>` | where the JSON files land |

## Engines

- **`bfc`** — the staged federated bag-set containment procedure (`solver`), which
  returns `contained` / `not contained` / `unknown`.
- **`specs`** — the bare SpeCS set-containment oracle on the same pairs, as a
  baseline. Two-valued; wrong wherever set and bag-set containment differ.

## Output

`results/<timestamp>/<engine>.<suite>.json`, one per engine × suite (e.g.
`bfc.star.json`, `specs.ucfq-scale.json`). Each carries its `meta` (environment,
repetitions), a `summary` (`meanMs` / `medianMs`, outcome counts with the
offending ids, `bySize` for the scale suites), and a `results` map keyed by pair
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

`outcome` is `correct` · `incorrect` (a wrong definite verdict) · `unknown` (the
procedure declined, a valid answer on the open fragment) · `error`.
