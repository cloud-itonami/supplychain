import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  registerNode,
  getNode,
  listNodes,
  addDependency,
  getDependency,
  listDependencies,
  coverage,
  clampRisk,
  depId,
} from "../src/index.js";

describe("supplychain kotoba", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: "did:web:supplychain.etzhayyim.com" });
  });

  describe("helpers", () => {
    it("clamps risk to 0..950", () => {
      expect(clampRisk(1200)).toBe(950);
      expect(clampRisk(-5)).toBe(0);
      expect(clampRisk(400)).toBe(400);
    });
    it("depId is direction + relation aware", () => {
      expect(depId("SUP-1", "MAT-1", "suppliesMaterial")).toBe("sup-1-suppliesMaterial-mat-1");
    });
  });

  describe("nodes", () => {
    it("registers + gets + filters by kind/risk", async () => {
      expect((await registerNode(e, { nodeId: "SUP-1", kind: "supplier", name: "Acme Foundry", riskPermille: 1500 })).status).toBe("registered");
      const n = await getNode(e, { nodeId: "SUP-1" });
      expect(n.node?.riskPermille).toBe(950); // clamped
      await registerNode(e, { nodeId: "MAT-1", kind: "material", name: "Steel", riskPermille: 200 });
      expect((await listNodes(e, { kind: "supplier" })).total).toBe(1);
      expect((await listNodes(e, { minRiskPermille: 900 })).total).toBe(1);
    });
    it("is idempotent + rejects bad kind", async () => {
      await registerNode(e, { nodeId: "SUP-1", kind: "supplier", name: "Acme" });
      expect((await registerNode(e, { nodeId: "SUP-1", kind: "supplier", name: "Acme" })).status).toBe("alreadyExists");
      expect((await registerNode(e, { nodeId: "X", kind: "factory" as any, name: "X" })).status).toBe("rejected");
    });
  });

  describe("dependencies", () => {
    beforeEach(async () => {
      await registerNode(e, { nodeId: "SUP-1", kind: "supplier", name: "Acme Foundry" });
      await registerNode(e, { nodeId: "MAT-1", kind: "material", name: "Steel" });
      await registerNode(e, { nodeId: "ASM-1", kind: "assembly", name: "Chassis" });
    });
    it("adds an edge between existing nodes", async () => {
      const r = await addDependency(e, { fromNodeId: "SUP-1", toNodeId: "MAT-1", relation: "suppliesMaterial", weightPermille: 800 });
      expect(r.status).toBe("added");
      const got = await getDependency(e, { fromNodeId: "SUP-1", toNodeId: "MAT-1", relation: "suppliesMaterial" });
      expect(got.dependency?.weightPermille).toBe(800);
    });
    it("rejects missing endpoints + self edges + bad relation", async () => {
      expect((await addDependency(e, { fromNodeId: "SUP-1", toNodeId: "GHOST", relation: "suppliesMaterial" })).status).toBe("nodeNotFound");
      expect((await addDependency(e, { fromNodeId: "SUP-1", toNodeId: "SUP-1", relation: "suppliesMaterial" })).status).toBe("rejected");
      expect((await addDependency(e, { fromNodeId: "SUP-1", toNodeId: "MAT-1", relation: "owns" as any })).status).toBe("rejected");
    });
    it("is idempotent per (from, relation, to)", async () => {
      await addDependency(e, { fromNodeId: "SUP-1", toNodeId: "MAT-1", relation: "suppliesMaterial" });
      expect((await addDependency(e, { fromNodeId: "SUP-1", toNodeId: "MAT-1", relation: "suppliesMaterial" })).status).toBe("alreadyExists");
    });
    it("lists by from + coverage aggregates", async () => {
      await addDependency(e, { fromNodeId: "SUP-1", toNodeId: "MAT-1", relation: "suppliesMaterial" });
      await addDependency(e, { fromNodeId: "MAT-1", toNodeId: "ASM-1", relation: "materialInAssembly" });
      expect((await listDependencies(e, { fromNodeId: "SUP-1" })).total).toBe(1);
      const cov = await coverage(e);
      expect(cov.nodeCount).toBe(3);
      expect(cov.nodesByKind?.supplier).toBe(1);
      expect(cov.dependencyCount).toBe(2);
      expect(cov.dependenciesByRelation?.suppliesMaterial).toBe(1);
    });
  });
});
