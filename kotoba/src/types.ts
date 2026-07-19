/**
 * supplychain kotoba — record types.
 *
 * Per ADR-2605203000 Option B. Supply graph: material / assembly / supplier /
 * company nodes + dependency edges + per-node risk. Public supply-chain
 * intelligence → registry on AT PDS records (replaces vertex_jukyu_supply_node /
 * edge_jukyu_supply_dependency). No RW, no on-chain settlement (not commerce).
 * ADR-2605172000 kotoba.
 *
 * Identity hierarchy:
 *   did:web:supplychain.etzhayyim.com                     — controller
 *   did:web:supplychain.etzhayyim.com:node:{nodeId}       — a supply node
 *   did:web:supplychain.etzhayyim.com:dep:{depId}         — a dependency edge
 */

export const SC_DID_PREFIX = "did:web:supplychain.etzhayyim.com:" as const;

export const NODE_COLLECTION = "com.etzhayyim.apps.supplychain.node";
export const DEPENDENCY_COLLECTION = "com.etzhayyim.apps.supplychain.dependency";

export type NodeKind = "material" | "assembly" | "supplier" | "company";

/** Dependency relation: a supplier supplies a material; a material composes an assembly. */
export type Relation = "suppliesMaterial" | "materialInAssembly";

/** Risk is capped at 0.95 (950 permille) per the supplychain risk model. */
export const RISK_CAP_PERMILLE = 950;

export interface SupplyNodeRecord {
  did: string;
  nodeId: string;
  kind: NodeKind;
  name: string;
  /** Whole-unit balance / demand (AT Lexicon has no float). */
  balanceQuantity?: number;
  demandQuantity?: number;
  /** Composite supply risk, 0–950 permille (capped). */
  riskPermille?: number;
  createdAt: string;
}

export interface SupplyNodeView extends SupplyNodeRecord {
  nodeUri: string;
}

export interface RegisterNodeInput {
  nodeId: string;
  kind: NodeKind;
  name: string;
  balanceQuantity?: number;
  demandQuantity?: number;
  riskPermille?: number;
}

export interface RegisterNodeOutput {
  status: "registered" | "alreadyExists" | "rejected";
  nodeUri?: string;
  did?: string;
  nodeId?: string;
  error?: string;
}

export interface GetNodeInput {
  nodeId: string;
}

export interface GetNodeOutput {
  node?: SupplyNodeView;
  error?: string;
}

export interface ListNodesInput {
  kind?: NodeKind;
  /** Only nodes with riskPermille >= this. */
  minRiskPermille?: number;
  limit?: number;
  cursor?: string;
}

export interface ListNodesOutput {
  items: SupplyNodeView[];
  cursor?: string;
  total: number;
}

// ─── Dependency edge ────────────────────────────────────────────────

export interface DependencyRecord {
  did: string;
  depId: string;
  fromNodeId: string;
  toNodeId: string;
  relation: Relation;
  /** Edge weight, 0–1000 permille. */
  weightPermille?: number;
  createdAt: string;
}

export interface DependencyView extends DependencyRecord {
  dependencyUri: string;
}

export interface AddDependencyInput {
  fromNodeId: string;
  toNodeId: string;
  relation: Relation;
  weightPermille?: number;
}

export interface AddDependencyOutput {
  status: "added" | "alreadyExists" | "rejected" | "nodeNotFound";
  dependencyUri?: string;
  did?: string;
  depId?: string;
  error?: string;
}

export interface ListDependenciesInput {
  fromNodeId?: string;
  toNodeId?: string;
  relation?: Relation;
  limit?: number;
  cursor?: string;
}

export interface ListDependenciesOutput {
  items: DependencyView[];
  cursor?: string;
  total: number;
}

export interface CoverageInput {
  maxScan?: number;
}

export interface CoverageOutput {
  nodeCount?: number;
  nodesByKind?: Record<string, number>;
  atRiskCount?: number;
  dependencyCount?: number;
  dependenciesByRelation?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

export function clampRisk(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(RISK_CAP_PERMILLE, Math.round(p)));
}

export function nodeDid(nodeId: string): string {
  return `${SC_DID_PREFIX}node:${nodeId.toLowerCase()}`;
}

export function nodeRkey(nodeId: string): string {
  return `node-${nodeId.toLowerCase()}`;
}

export function depId(fromNodeId: string, toNodeId: string, relation: Relation): string {
  return `${fromNodeId.toLowerCase()}-${relation}-${toNodeId.toLowerCase()}`;
}

export function dependencyDid(id: string): string {
  return `${SC_DID_PREFIX}dep:${id}`;
}

export function dependencyRkey(id: string): string {
  return `dep-${id}`;
}
