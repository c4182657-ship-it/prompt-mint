import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  buildProvenanceBadge,
  listArtifacts,
  parseArgs,
  sha256Hex,
  validateManifest,
  verifyArtifacts,
} from "../../scripts/deploy-manifest.mjs";

const ADMIN = `G${"A".repeat(55)}`;
const FEE_WALLET = `G${"B".repeat(55)}`;
const CONTRACT_ID = `C${"D".repeat(55)}`;
const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const COMMIT = "a".repeat(40);

const wasmBytes = new TextEncoder().encode("fake wasm bytes");
const frontendBytes = new TextEncoder().encode("abc123  ./index.html\n");

function makeManifest(overrides: Record<string, unknown> = {}) {
  return buildManifest({
    network: {
      name: "testnet",
      passphrase: "Test SDF Network ; September 2015",
      rpcUrl: "https://soroban-testnet.stellar.org",
    },
    contractId: CONTRACT_ID,
    wasm: {
      path: "prompt_hash.wasm",
      sha256: sha256Hex(wasmBytes),
      sizeBytes: wasmBytes.length,
    },
    addresses: {
      admin: ADMIN,
      feeWallet: FEE_WALLET,
      xlmSac: XLM_SAC,
      adminTwo: undefined,
    },
    artifacts: [
      {
        path: "frontend-checksums.txt",
        sha256: sha256Hex(frontendBytes),
        sizeBytes: frontendBytes.length,
      },
    ],
    source: {
      repository: "PromptMintLabs/prompt-mint",
      commit: COMMIT,
      ref: "main",
    },
    generatedAt: "2026-09-23T12:00:00.000Z",
    ...overrides,
  });
}

const files: Record<string, Uint8Array> = {
  "prompt_hash.wasm": wasmBytes,
  "frontend-checksums.txt": frontendBytes,
};
const readFile = (file: string) => files[file] ?? null;

describe("deploy manifest", () => {
  it("hashes with SHA-256 (the same digest Soroban uses for Wasm hashes)", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("builds a valid manifest with hashes and addresses", () => {
    const manifest = makeManifest();

    expect(validateManifest(manifest)).toEqual([]);
    expect(manifest.contracts.prompt_hash.contractId).toBe(CONTRACT_ID);
    expect(manifest.addresses).toEqual({
      admin: ADMIN,
      feeWallet: FEE_WALLET,
      xlmSac: XLM_SAC,
    });
    expect(
      listArtifacts(manifest).map((a: { path: string }) => a.path),
    ).toEqual(["prompt_hash.wasm", "frontend-checksums.txt"]);
  });

  it("accepts build-only manifests without a contract ID", () => {
    expect(
      validateManifest(makeManifest({ contractId: null, addresses: {} })),
    ).toEqual([]);
  });

  it("rejects malformed addresses, hashes, and commits", () => {
    const manifest = makeManifest({
      contractId: "not-a-contract",
      addresses: { admin: CONTRACT_ID, feeWalet: FEE_WALLET },
      source: { commit: "abc123" },
      wasm: { path: "prompt_hash.wasm", sha256: "XYZ", sizeBytes: -1 },
    });

    expect(validateManifest(manifest)).toEqual(
      expect.arrayContaining([
        "contracts.prompt_hash.contractId is not a valid Stellar contract ID",
        "addresses.admin is not a valid Stellar account ID",
        "addresses.feeWalet is not a recognised address field",
        "source.commit must be a full 40-character git SHA",
        "contracts.prompt_hash.wasm.sha256 must be a lowercase hex SHA-256",
        "contracts.prompt_hash.wasm.sizeBytes must be a non-negative integer",
      ]),
    );
  });

  it("verifies artifacts and reports mismatches and missing files", () => {
    const manifest = makeManifest();
    expect(
      verifyArtifacts(manifest, readFile).every(
        (r: { status: string }) => r.status === "ok",
      ),
    ).toBe(true);

    const tampered = verifyArtifacts(manifest, (file: string) =>
      file === "prompt_hash.wasm" ? new TextEncoder().encode("tampered") : null,
    );
    expect(tampered.map((r: { status: string }) => r.status)).toEqual([
      "mismatch",
      "missing",
    ]);
  });

  it("produces a green provenance badge only when everything verifies", () => {
    const manifest = makeManifest();

    expect(
      buildProvenanceBadge(manifest, verifyArtifacts(manifest, readFile)),
    ).toMatchObject({
      schemaVersion: 1,
      label: "deploy provenance",
      message: "verified · aaaaaaa",
      color: "brightgreen",
    });
    expect(
      buildProvenanceBadge(
        manifest,
        verifyArtifacts(manifest, () => null),
      ),
    ).toMatchObject({
      message: "unverified",
      color: "red",
    });
    expect(buildProvenanceBadge(manifest, [])).toMatchObject({
      message: "unverified",
    });
  });

  it("parses CLI flags, including repeated --artifact", () => {
    expect(
      parseArgs([
        "generate",
        "--network",
        "testnet",
        "--fee-wallet",
        FEE_WALLET,
        "--artifact",
        "a",
        "--artifact",
        "b",
      ]),
    ).toEqual({
      command: "generate",
      flags: {
        network: "testnet",
        feeWallet: FEE_WALLET,
        artifact: ["a", "b"],
      },
    });
    expect(() => parseArgs(["generate", "--network"])).toThrow(
      "Missing value for --network",
    );
  });
});

describe("committed deploy manifests", () => {
  const dir = path.resolve(__dirname, "../../deployments");
  const manifests = existsSync(dir)
    ? readdirSync(dir).filter((file) => file.endsWith(".json"))
    : [];

  if (manifests.length === 0) {
    it.skip("no manifests committed yet", () => {});
  } else {
    it.each(manifests)("deployments/%s is schema-valid", (file) => {
      const manifest = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
      expect(validateManifest(manifest)).toEqual([]);
    });
  }
});
