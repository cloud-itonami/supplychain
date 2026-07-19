/**
 * supplychain kotoba — dependency-edge registry + coverage. AT PDS records.
 * addDependency / getDependency / listDependencies + coverage.
 * An edge is unique per (from, relation, to); both endpoints must be nodes.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  DEPENDENCY_COLLECTION,
  NODE_COLLECTION,
  RISK_CAP_PERMILLE,
  dependencyDid,
  dependencyRkey,
  depId,
  nodeRkey,
  type AddDependencyInput,
  type AddDependencyOutput,
  type CoverageInput,
  type CoverageOutput,
  type DependencyRecord,
  type DependencyView,
  type ListDependenciesInput,
  type ListDependenciesOutput,
  type NodeKind,
  type Relation,
  type SupplyNodeRecord,
} from "./types.js";

const RELATIONS: ReadonlySet<Relation> = new Set(["suppliesMaterial", "materialInAssembly"]);

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

async function nodeExists(e: Etzhayyim, nodeId: string): Promise<boolean> {
  const resp = await e
    .read<SupplyNodeRecord>({ collection: NODE_COLLECTION, rkey: nodeRkey(nodeId) })
    .catch(() => ({ records: [] }));
  return Boolean(resp.records[0]?.value);
}

export async function addDependency(
  e: Etzhayyim,
  input: AddDependencyInput
): Promise<AddDependencyOutput> {
  if (!input.fromNodeId || !input.toNodeId || !input.relation) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  if (!RELATIONS.has(input.relation)) {
    return { status: "rejected", error: "invalidRelation" };
  }
  if (input.fromNodeId.toLowerCase() === input.toNodeId.toLowerCase()) {
    return { status: "rejected", error: "selfEdge" };
  }
  if (!(await nodeExists(e, input.fromNodeId)) || !(await nodeExists(e, input.toNodeId))) {
    return { status: "nodeNotFound", error: "endpointNotFound" };
  }

  const id = depId(input.fromNodeId, input.toNodeId, input.relation);
  const rkey = dependencyRkey(id);
  const existing = await e
    .read<DependencyRecord>({ collection: DEPENDENCY_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return {
      status: "alreadyExists",
      dependencyUri: existing.records[0].uri,
      did: existing.records[0].value.did,
      depId: id,
    };
  }

  const did = dependencyDid(id);
  const weight =
    typeof input.weightPermille === "number"
      ? Math.max(0, Math.min(1000, Math.round(input.weightPermille)))
      : undefined;
  const record: DependencyRecord = {
    did,
    depId: id,
    fromNodeId: input.fromNodeId.toLowerCase(),
    toNodeId: input.toNodeId.toLowerCase(),
    relation: input.relation,
    weightPermille: weight,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({
    collection: DEPENDENCY_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "added", dependencyUri: receipt.uri, did, depId: id };
}

export async function getDependency(
  e: Etzhayyim,
  input: { fromNodeId: string; toNodeId: string; relation: Relation }
): Promise<{ dependency?: DependencyView; error?: string }> {
  if (!input.fromNodeId || !input.toNodeId || !input.relation) {
    return { error: "missingKey" };
  }
  const id = depId(input.fromNodeId, input.toNodeId, input.relation);
  const resp = await e
    .read<DependencyRecord>({ collection: DEPENDENCY_COLLECTION, rkey: dependencyRkey(id) })
    .catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { dependency: { ...r.value, dependencyUri: r.uri } };
}

export async function listDependencies(
  e: Etzhayyim,
  input: ListDependenciesInput = {}
): Promise<ListDependenciesOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<DependencyRecord>({
    collection: DEPENDENCY_COLLECTION,
    cursor: input.cursor,
    limit,
  });
  const items: DependencyView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.fromNodeId && v.fromNodeId !== input.fromNodeId.toLowerCase()) return false;
      if (input.toNodeId && v.toNodeId !== input.toNodeId.toLowerCase()) return false;
      if (input.relation && v.relation !== input.relation) return false;
      return true;
    })
    .map((r) => ({ ...r.value, dependencyUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

export async function coverage(
  e: Etzhayyim,
  input: CoverageInput = {}
): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);

  const nodesByKind: Record<string, number> = {};
  let nodeCount = 0;
  let atRiskCount = 0;
  let nodeCursor: string | undefined;
  let nscanned = 0;
  while (nscanned < maxScan) {
    const page = await e.read<SupplyNodeRecord>({
      collection: NODE_COLLECTION,
      cursor: nodeCursor,
      limit: PAGE_LIMIT,
    });
    for (const r of page.records) {
      if (nscanned >= maxScan) break;
      nodesByKind[r.value.kind as NodeKind] = (nodesByKind[r.value.kind as NodeKind] ?? 0) + 1;
      if ((r.value.riskPermille ?? 0) >= RISK_CAP_PERMILLE) atRiskCount += 1;
      nodeCount += 1;
      nscanned += 1;
    }
    if (nscanned >= maxScan || !page.cursor || page.records.length < PAGE_LIMIT) break;
    nodeCursor = page.cursor;
  }

  const dependenciesByRelation: Record<string, number> = {};
  let dependencyCount = 0;
  let depCursor: string | undefined;
  let dscanned = 0;
  while (dscanned < maxScan) {
    const page = await e.read<DependencyRecord>({
      collection: DEPENDENCY_COLLECTION,
      cursor: depCursor,
      limit: PAGE_LIMIT,
    });
    for (const r of page.records) {
      if (dscanned >= maxScan) break;
      dependenciesByRelation[r.value.relation as Relation] =
        (dependenciesByRelation[r.value.relation as Relation] ?? 0) + 1;
      dependencyCount += 1;
      dscanned += 1;
    }
    if (dscanned >= maxScan || !page.cursor || page.records.length < PAGE_LIMIT) break;
    depCursor = page.cursor;
  }

  return {
    nodeCount,
    nodesByKind,
    atRiskCount,
    dependencyCount,
    dependenciesByRelation,
    truncated: nscanned >= maxScan || dscanned >= maxScan,
  };
}
