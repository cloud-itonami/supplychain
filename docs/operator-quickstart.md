# Operator quickstart

There is exactly one runnable thing in this repository: the TypeScript
reference implementation under `kotoba/`. It has no server, no CLI and no
deployed surface — you exercise it by running its tests or by importing it from
a program you write. See the README's
[*What is not here*](../README.md#what-is-not-here) before planning around it.

Every command below was run against commit `4ca51a4` on 2026-08-15 (UTC) on
macOS 26.3.1 (darwin arm64), Node v26.3.0 / npm 11.16.0. Steps are marked ✅
where the output shown is the output observed, and ⚠️ where they were not
walked. **Read [step 0](#0-before-npm-install-) first** — without it
`npm install` fails, and the failure blames the wrong thing.

---

## 0. Before `npm install` ✅

`npm install` fails here with an error that points at the dependency:

```
npm error code 1
npm error git dep preparation failed
npm error npm error code EALLOWSCRIPTS
npm error npm error --allow-scripts is not allowed in project-scoped installs.
npm error npm error Add the entries to the "allowScripts" field in package.json, or to .npmrc, instead.
```

**The cause is your `~/.npmrc`, not this repository.** If it contains any
`allow-scripts[]=…` line, npm passes `--allow-scripts` into the subprocess it
spawns to prepare git dependencies, and that subprocess rejects the flag. Both
of this package's dependencies are git dependencies whose `prepare` script is
`tsc`, so every install takes that path. Following the error's own advice does
not help — the flag is injected by npm itself, not by anything you wrote.

Install with the user config out of the way:

```bash
: > /tmp/empty-npmrc
npm install --userconfig=/tmp/empty-npmrc
```

`--userconfig` also drops private-registry auth and `strict-ssl` settings. This
package needs neither: everything comes from the public npm registry or from
GitHub.

> This is a workstation-wide condition, not a supplychain one. `sanctions`
> hit it independently and measured it across npm versions and fleet nodes —
> see `orgs/cloud-itonami/sanctions/docs/operator-quickstart.md` § 0 for that
> table rather than re-deriving it.

## 1. Install ✅

```bash
cd kotoba
npm install --userconfig=/tmp/empty-npmrc     # see step 0
```

```
added 135 packages, and audited 136 packages in 6m
found 0 vulnerabilities
```

Six minutes is normal on a cold npm cache — most of it is cloning the
`@etzhayyim` git dependencies and their transitive `@signalapp/libsignal-client`.

The install ends with a warning that 8 packages have `prepare: tsc` /
`install` scripts that were **not run**:

```
npm warn allow-scripts 8 packages have install scripts not yet covered by allowScripts:
npm warn allow-scripts   @etzhayyim/sdk@0.1.0-alpha (prepare: tsc)
…
```

**Ignore it for this package.** Nothing here consumes the SDK's compiled
output: `kotoba/src` imports only `import type { Etzhayyim }`, which is erased
at compile time, and the tests run against `@etzhayyim/sdk-mock`. Steps 2 and 3
pass with those scripts unrun. A program that actually talks to a PDS *would*
need the SDK built.

Installed: `@etzhayyim/sdk` 0.1.0-alpha, `@etzhayyim/sdk-mock` 0.1.0.

Both dependencies are pinned to full SHAs. Neither SHA is an advertised ref
(they are not branch or tag tips), so `git ls-remote | grep <sha>` finds
nothing — but both are still fetchable, which is what npm needs, and the
install above proves it.

There is no `package-lock.json` in the tree, so `npm ci` is not available.
Running the install creates one; it is gitignored.

## 2. Run the tests ✅

```bash
npm test
```

```
 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  893ms
```

Exit code 0 (checked separately — vitest's summary and its exit status are
different claims).

The 8 tests are in `test/supplychain.test.ts` and run entirely against
`MockEtzhayyim`. No network, no PDS, no credentials.

## 3. Typecheck ✅

```bash
npm run typecheck
```

Silent, exit code 0. `tsconfig.json` is `strict: true` but its `include` is
`src/**/*.ts` only — **the test file is not typechecked**, which is why the
deliberate `as any` casts in it do not fail this step.

That was checked in both directions, since "no output" is what a typecheck that
never ran also looks like. Appending the identical line
`const deliberateTypeError: number = "not a number";` to each file:

| where | result |
|---|---|
| `test/supplychain.test.ts` | exit 0, 0 errors — **not seen** |
| `src/index.ts` | exit 2, `error TS2322` |

## 4. Does the suite discriminate? ✅

A test suite that cannot go red tells you nothing. Three mutations were applied
one at a time, each reverted before the next:

| # | Mutation | Result |
|---|---|---|
| 1 | `RISK_CAP_PERMILLE = 950` → `951` | ❌ exit 1 — 2 failed / 6 passed |
| 2 | delete the `selfEdge` rejection in `addDependency` | ❌ exit 1 — 1 failed / 7 passed |
| 3 | make `depId` direction-blind (sort the endpoints) | ❌ exit 1 — 1 failed / 7 passed |
| — | unmodified tree | ✅ exit 0 — 8 passed |

So the risk cap, the self-edge guard and edge direction are all genuinely
pinned. Note what mutation 1 shows: a **one-permille** change is caught, because
the test asserts the clamped value exactly.

Not everything is pinned. `coverage().atRiskCount` and the `weightPermille`
clamp have no assertions — see the README's *Known gaps*.

## 5. Call it from a program ⚠️ NOT WALKED

Against a real PDS this needs an `Etzhayyim` handle with credentials, which
were not available here. The shape, from the source:

```ts
import { registerNode, addDependency, coverage } from "./src/index.js";

await registerNode(e, { nodeId: "SUP-1", kind: "supplier", name: "Acme Foundry" });
await registerNode(e, { nodeId: "MAT-1", kind: "material", name: "Steel" });
await addDependency(e, {
  fromNodeId: "SUP-1", toNodeId: "MAT-1",
  relation: "suppliesMaterial", weightPermille: 800,
});
await coverage(e);   // { nodeCount, nodesByKind, atRiskCount, dependencyCount, … }
```

The same sequence *was* walked against `MockEtzhayyim` — that is what step 2
runs. What is unverified is only the real-PDS handle, and building the SDK
(step 1) is a prerequisite for it.

## 6. What the tree contains ✅

All 18 tracked files. The first three were added with this document; the other
15 are the tree as extracted.

```
README.md                      what is actually here
docs/operator-quickstart.md    this file
.gitignore                     node_modules, package-lock

CLAUDE.md                      pre-migration design doc — see README
MIGRATION-TODO.md              substrate-boundary checklist, unfinished
NOTICE                         Apache-2.0
PROJECT.jsonld                 capabilities; declares a URL that does not resolve
scheduler.jsonld               three milestones, none marked done
README.edn                     113 bytes of metadata
migration.edn                  extraction provenance
kotoba/package.json            two git deps, two scripts
kotoba/tsconfig.json           strict, src only
kotoba/vitest.config.ts        node environment, test/**/*.test.ts
kotoba/src/types.ts            records, helpers, the 950 cap
kotoba/src/node.ts             registerNode / getNode / listNodes
kotoba/src/dependency.ts       addDependency / getDependency / listDependencies / coverage
kotoba/src/index.ts            barrel
kotoba/test/supplychain.test.ts  8 tests
```

## 7. A note on the fleet maturity score

The fleet scan (`scripts/itonami-maturity-scan.cljs` in the superproject) reads
top-level `src/` and `test/`. This repository keeps both one level down, under
`kotoba/`, so the scan records **0 source bytes and 0 test bytes** — for a tree
that has ~14 KB of TypeScript and a passing 8-test suite.

That is a property of where the directories sit, not of the repository's
contents, and it is shared by other repositories in this cohort. Do not read
`substrate = 0` / `test = 0` here as "there is no code and no tests". Moving the
directories would change the score without changing anything real, so it is not
done as part of a documentation change.
