import { existsSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const repoFile = (file: string) => path.resolve(__dirname, "../../..", file);
const read = (file: string) => readFileSync(repoFile(file), "utf8");

const WORKFLOW_BADGE =
  /\[!\[Deploy provenance\]\(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/workflows\/([\w.-]+\.yml)\/badge\.svg\?branch=main\)\]/;

describe("verified deployment provenance badge", () => {
  it.each(["README.md", "docs/artifact-verification.md"])(
    "%s shows the live deploy provenance badge and the SLSA badge",
    (doc) => {
      const content = read(doc);
      const match = content.match(WORKFLOW_BADGE);

      expect(
        match,
        `${doc} is missing the Deploy provenance badge`,
      ).not.toBeNull();
      expect(existsSync(repoFile(`.github/workflows/${match![1]}`))).toBe(true);
      expect(content).toMatch(
        /\[!\[SLSA provenance: attested\]\([^)]+\)\]\([^)]*verified-deployment-provenance-badge\)/,
      );
    },
  );

  it("documents what the badge means", () => {
    expect(read("docs/artifact-verification.md")).toContain(
      "## Verified Deployment Provenance Badge",
    );
  });

  it("points at a workflow that signs, attests and verifies provenance before releasing", () => {
    const workflow = read(".github/workflows/deploy.yml");

    expect(workflow).toContain("cosign sign-blob");
    expect(workflow).toContain("actions/attest-build-provenance");
    expect(workflow).toContain("Verify deployment provenance");
    expect(workflow).toContain("cosign verify-blob");
    expect(workflow).toContain("scripts/deploy-manifest.mjs verify");

    // Verification must gate the release, otherwise a green badge proves nothing.
    expect(workflow.indexOf("Verify deployment provenance")).toBeLessThan(
      workflow.indexOf("Create GitHub Release"),
    );
  });
});
