# supplychain

A **supply-graph registry** on AT Protocol PDS records: supplier / material /
assembly / company nodes, dependency edges between them, and a per-node risk
score. It is a registry, not a marketplace — nothing here settles a payment or
prices anything.

The whole repository is 18 tracked files, three of which are this
documentation. The working part is `kotoba/`: four TypeScript modules (~14 KB)
and one test file, built on `@etzhayyim/sdk`.

**Before you read `AGENTS.md`, read [§ What `AGENTS.md` describes](#what-claudemd-describes-and-why-it-is-not-this-repository).**
It documents a different system than the one in this tree.

---

## The model

Two record collections, both written to an AT PDS:

| Collection | Record | Key |
|---|---|---|
| `com.etzhayyim.apps.supplychain.node` | supply node | `node-{nodeId}` (lowercased) |
| `com.etzhayyim.apps.supplychain.dependency` | dependency edge | `dep-{from}-{relation}-{to}` (lowercased) |

A node is one of four kinds — `material`, `assembly`, `supplier`, `company`.
An edge carries one of two relations — `suppliesMaterial` (supplier → material)
or `materialInAssembly` (material → assembly).

Identity is derived, not stored separately:

```
did:web:supplychain.etzhayyim.com                  controller
did:web:supplychain.etzhayyim.com:node:{nodeId}    a supply node
did:web:supplychain.etzhayyim.com:dep:{depId}      a dependency edge
```

Quantities and weights are integers because AT Lexicon has no float type. Risk
and edge weight are therefore **permille** (0–1000), not fractions.

### The seven functions

```ts
import {
  registerNode, getNode, listNodes,
  addDependency, getDependency, listDependencies, coverage,
} from "@etzhayyim/supplychain-kotoba";
```

Each takes an `Etzhayyim` SDK handle as its first argument and returns a plain
result object — none of them throw for domain rejections. `registerNode` and
`addDependency` return a `status` (`registered` / `added` / `alreadyExists` /
`rejected` / `nodeNotFound`) rather than signalling by exception.

### Invariants the code actually enforces

Each of these is covered by the test suite, and each was confirmed to fail the
suite when deliberately broken (see the quickstart, § *Does the suite
discriminate?*):

- **Risk is capped at 950 permille.** `clampRisk` floors at 0 and caps at
  `RISK_CAP_PERMILLE = 950`; a caller passing 1500 gets 950 stored.
- **Edges are directed and relation-scoped.** `depId(from, to, relation)` keeps
  direction — `SUP-1 --suppliesMaterial--> MAT-1` is a different edge from the
  reverse.
- **Both endpoints must already be nodes.** `addDependency` reads both before
  writing and returns `nodeNotFound` otherwise.
- **Self-edges are rejected**, case-insensitively.
- **Both writes are idempotent** on their derived rkey — re-registering returns
  `alreadyExists` with the existing URI rather than overwriting.

## What `AGENTS.md` describes, and why it is not this repository

`AGENTS.md` describes a Python service: a FastAPI server on port 8000, a
LangGraph Pregel graph `supplychain_cleaning_robot_v1` with 8 supersteps and
0.70 damping, three in-process cron tasks, a Helm release `lg-supplychain-pool`,
a `Dockerfile.supplychain`, four `tests/test_*.py` files, and RisingWave tables
`vertex_jukyu_supply_node` / `edge_jukyu_supply_dependency` reached over
`PSYCOPG_CONNSTRING`.

**None of those files exist here.** The tree has zero `.py`, `.sql`, `.yaml`
and zero Dockerfiles; `git ls-files` returns 18 paths, listed in the quickstart.

This is not rot that someone forgot to clean — it is the *pre-migration* design
doc, carried over verbatim when the app was extracted from `etzhayyim/root`
(see `migration.edn`). `MIGRATION-TODO.md` is the other half of the story: it
requires that RisingWave / Postgres / Kysely be stripped and the app moved onto
AT Protocol MST + IPFS. **`kotoba/` is that replacement.** The substrate changed;
the domain model largely survived — the 0.95 risk cap and the
node/edge/relation vocabulary in `AGENTS.md` are the same ones the TypeScript
implements.

Read `AGENTS.md` as history — it is the best available description of the
intended *behaviour* (pressure propagation, company exposure scoring) that
`kotoba/` does not yet implement.

## What is not here

Stated plainly, because several of these are promised elsewhere in the tree:

- **No deployed surface.** `PROJECT.jsonld` declares
  `"schema:url": "https://supplychain.etzhayyim.com"`. That host **does not
  resolve** — checked 2026-08-15; the `etzhayyim.com` apex does resolve, the
  subdomain has no record. There is no appview, no worker, no static site.
- **No pressure propagation.** The Pregel model — the thing that made this an
  *intelligence* app rather than a registry — has no counterpart in `kotoba/`.
  `coverage()` counts records; it does not score anything.
- **No adapter.** `normalize_cleaning_robot()`, which populated the graph from
  automotive/robotics tables, was not carried over. Nothing here ingests real
  supply-chain data; the only data that has ever passed through these functions
  is the fixtures in the test file.
- **No CLI, no HTTP entry point.** The package exports functions. Calling them
  requires writing a program that constructs an `Etzhayyim` handle.
- **No lockfile**, so `npm ci` is unavailable. Dependencies are two git pins.

## Known gaps in the code itself

Observed by running the code, not by reading it:

- **`coverage().atRiskCount` counts only nodes at exactly the 950 cap.** The
  test is `riskPermille >= RISK_CAP_PERMILLE`, so a node at 949 permille — a
  94.9 % risk — is not counted as at-risk, while any value ≥ 950 is (having been
  clamped to 950 on write). Registering nodes at 949 / 950 / 5000 yields
  `atRiskCount: 2`. Whether that is the intended meaning of "at risk" or a
  threshold that should be configurable is a question for whoever owns the risk
  model; it is recorded here because the existing suite does not assert
  `atRiskCount` at all and so would not notice a change.
- **`weightPermille` is clamped to 0–1000 with no test.** The clamp works
  (confirmed), but nothing pins it.
- **`listNodes` / `listDependencies` filter after paging.** The `kind`,
  `minRiskPermille`, `fromNodeId` … filters are applied to the single page the
  PDS returned, so `total` is the count *within that page*, not across the
  collection. Registering 60 `material` nodes and calling
  `listNodes({ kind: "material" })` returns `total: 50` — the default limit —
  plus a cursor the caller must follow to see the rest. A filtered query can
  also return far fewer than `limit` items while many more matches exist
  further down. `coverage()` pages properly; the list functions do not.

## Getting started

`docs/operator-quickstart.md` — every command in it was run, and the output
shown is the output observed.

## Provenance

Extracted from `etzhayyim/root` at `60-apps/etzhayyim-project-supplychain`
(revision `c3a74d2`, 13 files, 31,549 bytes) — see `migration.edn`.
Licensed Apache-2.0; see `NOTICE`.
