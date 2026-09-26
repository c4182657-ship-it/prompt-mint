// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("Reproducible devcontainer environment (Issue #793)", () => {
  const root = path.resolve(__dirname, "../..");
  const devcontainerPath = path.join(root, ".devcontainer/devcontainer.json");
  const dockerfilePath = path.join(root, ".devcontainer/Dockerfile");
  const postCreatePath = path.join(
    root,
    ".devcontainer/postCreateCommand.sh",
  );
  const toolchainPath = path.join(root, "rust-toolchain.toml");
  const packageJsonPath = path.join(root, "package.json");
  const contributingPath = path.join(root, "docs/contributing.md");

  it("should pin the full toolchain in devcontainer.json", () => {
    expect(fs.existsSync(devcontainerPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(devcontainerPath, "utf-8"));

    expect(config.build.dockerfile).toBe("Dockerfile");
    expect(config.build.args.NODE_MAJOR).toBe("22");
    expect(config.build.args.RUST_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(config.build.args.YARN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(config.build.args.STELLAR_CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);

    expect(config.forwardPorts).toContain(5173);
    expect(config.forwardPorts).toContain(5000);
    expect(config.postCreateCommand).toContain("postCreateCommand.sh");
    expect(
      config.customizations?.vscode?.extensions?.length,
    ).toBeGreaterThan(0);
  });

  it("should keep Dockerfile, rust-toolchain, and packageManager in sync", () => {
    expect(fs.existsSync(dockerfilePath)).toBe(true);
    const dockerfile = fs.readFileSync(dockerfilePath, "utf-8");
    expect(dockerfile).toContain("FROM mcr.microsoft.com/devcontainers/base");
    expect(dockerfile).toContain("wasm32v1-none");
    expect(dockerfile).toContain("stellar-cli");

    const config = JSON.parse(fs.readFileSync(devcontainerPath, "utf-8"));
    const toolchain = fs.readFileSync(toolchainPath, "utf-8");
    expect(toolchain).toContain(config.build.args.RUST_VERSION);

    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf-8"),
    );
    expect(packageJson.packageManager).toContain(
      config.build.args.YARN_VERSION,
    );

    for (const arg of ["NODE_MAJOR", "RUST_VERSION", "YARN_VERSION"]) {
      expect(dockerfile).toContain(`ARG ${arg}=`);
    }
  });

  it("should bootstrap dependencies without bundling secrets", () => {
    expect(fs.existsSync(postCreatePath)).toBe(true);
    const script = fs.readFileSync(postCreatePath, "utf-8");
    expect(script).toContain("yarn install");
    expect(script).toContain(".env.example");

    const stat = fs.statSync(postCreatePath);
    expect(stat.mode & 0o111).toBeGreaterThan(0);

    expect(fs.existsSync(contributingPath)).toBe(true);
    const contributing = fs.readFileSync(contributingPath, "utf-8");
    expect(contributing).toContain(".devcontainer/");
    expect(contributing).toContain("Reopen in Container");
  });
});
