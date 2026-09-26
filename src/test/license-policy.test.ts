// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("Dependency licensing policy playbook (Issue #791)", () => {
  const policyPath = path.resolve(__dirname, "../../license-policy.json");
  const denyPath = path.resolve(__dirname, "../../deny.toml");
  const docPath = path.resolve(__dirname, "../../docs/license-policy.md");
  const scriptPath = path.resolve(
    __dirname,
    "../../scripts/license-audit.mjs",
  );

  it("should have a well-formed license-policy.json with disjoint categories", () => {
    expect(fs.existsSync(policyPath)).toBe(true);
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf-8"));

    for (const key of ["allowed", "denied", "reviewRequired", "exceptions"]) {
      expect(policy[key]).toBeDefined();
    }
    expect(Array.isArray(policy.allowed)).toBe(true);
    expect(Array.isArray(policy.denied)).toBe(true);
    expect(Array.isArray(policy.reviewRequired)).toBe(true);
    expect(Array.isArray(policy.exceptions)).toBe(true);

    // Core permissive licenses must stay allowed.
    for (const lic of ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]) {
      expect(policy.allowed).toContain(lic);
    }
    // Copyleft / commercial-use restrictions must stay denied.
    for (const lic of ["GPL-3.0", "AGPL-3.0", "BUSL-1.1", "SSPL-1.0", "Elastic-2.0", "CC-BY-NC-4.0"]) {
      expect(policy.denied).toContain(lic);
    }
    // Nuanced licenses must require human review.
    for (const lic of ["MPL-2.0", "CC-BY-4.0"]) {
      expect(policy.reviewRequired).toContain(lic);
    }

    // Categories must be mutually exclusive.
    const all = [...policy.allowed, ...policy.denied, ...policy.reviewRequired];
    expect(new Set(all).size).toBe(all.length);

    // Exceptions must follow the documented schema when present.
    for (const exc of policy.exceptions) {
      expect(typeof exc.package).toBe("string");
      expect(typeof exc.license).toBe("string");
      expect(typeof exc.owner).toBe("string");
      expect(typeof exc.rationale).toBe("string");
      expect(["cli-tool", "build-time", "runtime"]).toContain(exc.scope);
      expect(typeof exc.expiry).toBe("string");
    }
  });

  it("should keep deny.toml in sync with license-policy.json", () => {
    expect(fs.existsSync(denyPath)).toBe(true);
    const deny = fs.readFileSync(denyPath, "utf-8");
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf-8"));

    // Core overlap must hold on both sides of the polyglot policy.
    for (const lic of ["Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC"]) {
      expect(policy.allowed).toContain(lic);
      expect(deny).toContain(`"${lic}"`);
    }
    for (const lic of ["GPL-3.0", "AGPL-3.0", "LGPL-3.0", "BUSL-1.1", "SSPL-1.0"]) {
      expect(policy.denied).toContain(lic);
      expect(deny).toContain(`"${lic}"`);
    }
    expect(deny).toContain('unlicensed = "deny"');
  });

  it("should document the policy and enforcement script", () => {
    expect(fs.existsSync(docPath)).toBe(true);
    const doc = fs.readFileSync(docPath, "utf-8");
    expect(doc).toContain("license-policy.json");
    expect(doc).toContain("deny.toml");
    expect(doc).toContain("license-compliance");

    expect(fs.existsSync(scriptPath)).toBe(true);
    const script = fs.readFileSync(scriptPath, "utf-8");
    expect(script).toContain("license-policy.json");
  });
});
