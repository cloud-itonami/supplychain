/**
 * supplychain kotoba — barrel.
 *
 * Per ADR-2605203000 Option B. Supply graph (material/assembly/supplier/company
 * nodes + dependency edges + risk) on the etzhayyim substrate (AT PDS records;
 * no RW). Registry — not commerce, no on-chain settlement.
 *
 *   node       : registerNode / getNode / listNodes
 *   dependency : addDependency / getDependency / listDependencies / coverage
 */

export * from "./types.js";
export { registerNode, getNode, listNodes } from "./node.js";
export {
  addDependency,
  getDependency,
  listDependencies,
  coverage,
} from "./dependency.js";
