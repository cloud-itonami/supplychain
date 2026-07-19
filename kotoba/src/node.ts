/**
 * supplychain kotoba — supply-node registry. AT PDS records (no RW).
 * registerNode / getNode / listNodes.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  NODE_COLLECTION,
  clampRisk,
  nodeDid,
  nodeRkey,
  type GetNodeInput,
  type GetNodeOutput,
  type ListNodesInput,
  type ListNodesOutput,
  type NodeKind,
  type RegisterNodeInput,
  type RegisterNodeOutput,
  type SupplyNodeRecord,
  type SupplyNodeView,
} from "./types.js";

const KINDS: ReadonlySet<NodeKind> = new Set(["material", "assembly", "supplier", "company"]);

export async function registerNode(
  e: Etzhayyim,
  input: RegisterNodeInput
): Promise<RegisterNodeOutput> {
  if (!input.nodeId || !input.name || !input.kind) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  if (!KINDS.has(input.kind)) {
    return { status: "rejected", error: "invalidKind" };
  }

  const rkey = nodeRkey(input.nodeId);
  const existing = await e
    .read<SupplyNodeRecord>({ collection: NODE_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return {
      status: "alreadyExists",
      nodeUri: existing.records[0].uri,
      did: existing.records[0].value.did,
      nodeId: input.nodeId,
    };
  }

  const did = nodeDid(input.nodeId);
  const record: SupplyNodeRecord = {
    did,
    nodeId: input.nodeId,
    kind: input.kind,
    name: input.name,
    balanceQuantity: input.balanceQuantity,
    demandQuantity: input.demandQuantity,
    riskPermille:
      typeof input.riskPermille === "number" ? clampRisk(input.riskPermille) : undefined,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({
    collection: NODE_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "registered", nodeUri: receipt.uri, did, nodeId: input.nodeId };
}

export async function getNode(
  e: Etzhayyim,
  input: GetNodeInput
): Promise<GetNodeOutput> {
  if (!input.nodeId) return { error: "invalidNodeId" };
  const resp = await e
    .read<SupplyNodeRecord>({ collection: NODE_COLLECTION, rkey: nodeRkey(input.nodeId) })
    .catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { node: { ...r.value, nodeUri: r.uri } };
}

export async function listNodes(
  e: Etzhayyim,
  input: ListNodesInput = {}
): Promise<ListNodesOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<SupplyNodeRecord>({
    collection: NODE_COLLECTION,
    cursor: input.cursor,
    limit,
  });
  const items: SupplyNodeView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.kind && v.kind !== input.kind) return false;
      if (
        typeof input.minRiskPermille === "number" &&
        (v.riskPermille ?? 0) < input.minRiskPermille
      ) {
        return false;
      }
      return true;
    })
    .map((r) => ({ ...r.value, nodeUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}
