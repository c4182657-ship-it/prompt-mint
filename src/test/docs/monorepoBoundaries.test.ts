import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Enforces docs/monorepo-map.md: every top-level directory has an owner, and
 * cross-boundary imports only go in the allowed directions.
 */

const ROOT = path.resolve(__dirname, "../../..");
const MAP = readFileSync(path.join(ROOT, "docs/monorepo-map.md"), "utf8");

type Zone = "ui" | "lib" | "api" | "server" | "sdk" | "other";

// Zone → zones it must never import from (rules 1–6 in the map).
const FORBIDDEN: Record<Zone, Zone[]> = {
  ui: ["api", "server"],
  lib: ["api", "server"],
  server: ["api", "ui"],
  api: ["ui"],
  sdk: ["ui", "lib", "api", "server"],
  other: [],
};

const SCANNED_ROOTS = ["src", "api", "server/src", "packages/sdk/src"];
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const EXEMPT =
  /(\.test\.|\.spec\.|__tests__\/|^src\/test\/|^src\/stories\/|^server\/src\/tests\/)/;
const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function zoneOf(file: string): Zone {
  if (file.startsWith("src/lib/")) return "lib";
  if (file.startsWith("src/")) return "ui";
  if (file.startsWith("api/")) return "api";
  if (file.startsWith("server/")) return "server";
  if (file.startsWith("packages/sdk/")) return "sdk";
  return "other";
}

function walk(dir: string): string[] {
  const full = path.join(ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).flatMap((entry) => {
    if (entry === "node_modules") return [];
    const rel = `${dir}/${entry}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/"))
    return path.posix.normalize(`src/${spec.slice(2)}`);
  if (!spec.startsWith(".")) return null;
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(fromFile), spec),
  );
}

const stripExt = (file: string) =>
  file.replace(SOURCE_EXT, "").replace(/\/index$/, "");

function findViolations() {
  const violations: { file: string; target: string; rule: string }[] = [];
  const files = SCANNED_ROOTS.flatMap(walk).filter(
    (f) => SOURCE_EXT.test(f) && !EXEMPT.test(f),
  );

  for (const file of files) {
    const from = zoneOf(file);
    const source = readFileSync(path.join(ROOT, file), "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2] ?? match[3] ?? match[4];
      const target = resolveSpecifier(file, spec);
      if (!target) continue;
      const to = zoneOf(target);
      if (FORBIDDEN[from].includes(to)) {
        violations.push({
          file,
          target: stripExt(target),
          rule: `${from} → ${to}`,
        });
      }
    }
  }
  return violations;
}

function tableBetween(marker: string): string[][] {
  const block =
    MAP.split(`<!-- ${marker}:start -->`)[1]?.split(
      `<!-- ${marker}:end -->`,
    )[0] ?? "";
  return block
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
    .slice(1) // header row
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/^`|`$/g, "")),
    );
}

function ignoredTopLevelNames(): Set<string> {
  const lines = readFileSync(path.join(ROOT, ".gitignore"), "utf8").split("\n");
  return new Set(
    lines
      .map((line) => line.trim().replace(/\/$/, ""))
      .filter(
        (line) =>
          line &&
          !line.startsWith("#") &&
          !line.startsWith("!") &&
          !/[*/]/.test(line),
      ),
  );
}

describe("monorepo map (docs/monorepo-map.md)", () => {
  const ownership = tableBetween("ownership");
  const ownedPaths = ownership.map(([p]) => p.replace(/\/$/, ""));

  it("renders a mermaid diagram with every ownership area", () => {
    expect(MAP).toContain("```mermaid");
    for (const area of new Set(ownership.map(([, area]) => area))) {
      if (area === "Docs") continue; // docs are not a runtime node
      expect(MAP, `diagram is missing area "${area}"`).toMatch(
        new RegExp(`subgraph \\w+\\["${area}`),
      );
    }
  });

  it("only lists paths that exist", () => {
    expect(ownership.length).toBeGreaterThan(0);
    for (const owned of ownedPaths) {
      expect(
        existsSync(path.join(ROOT, owned)),
        `${owned} does not exist`,
      ).toBe(true);
    }
  });

  it("assigns an owner to every top-level directory", () => {
    const ignored = ignoredTopLevelNames();
    const topLevel = readdirSync(ROOT).filter(
      (entry) =>
        (entry === ".github" || !entry.startsWith(".")) &&
        !ignored.has(entry) &&
        entry !== "node_modules" &&
        statSync(path.join(ROOT, entry)).isDirectory(),
    );

    const unowned = topLevel.filter((dir) => !ownedPaths.includes(dir));
    expect(unowned, "add these directories to the ownership table").toEqual([]);
  });
});

describe("ownership boundaries", () => {
  const exceptions = tableBetween("exceptions").map(
    ([file, target]) => `${file} -> ${target}`,
  );
  const violations = findViolations();
  const found = violations.map((v) => `${v.file} -> ${v.target}`);

  it("has no cross-boundary imports beyond the tracked exceptions", () => {
    const untracked = violations.filter(
      (v) => !exceptions.includes(`${v.file} -> ${v.target}`),
    );
    expect(
      untracked,
      "new boundary violation — fix the import or add a tracked exception to docs/monorepo-map.md",
    ).toEqual([]);
  });

  it("only tracks exceptions that still exist", () => {
    const stale = exceptions.filter((exception) => !found.includes(exception));
    expect(stale, "remove fixed exceptions from docs/monorepo-map.md").toEqual(
      [],
    );
  });

  it("keeps contract crates hermetic (no Cargo path deps outside contracts/)", () => {
    const crates = readdirSync(path.join(ROOT, "contracts")).filter((crate) =>
      existsSync(path.join(ROOT, "contracts", crate, "Cargo.toml")),
    );
    expect(crates.length).toBeGreaterThan(0);

    for (const crate of crates) {
      const manifest = readFileSync(
        path.join(ROOT, "contracts", crate, "Cargo.toml"),
        "utf8",
      );
      for (const [, depPath] of manifest.matchAll(/path\s*=\s*"([^"]+)"/g)) {
        const resolved = path.posix.normalize(
          path.posix.join("contracts", crate, depPath),
        );
        expect(
          resolved.startsWith("contracts/"),
          `${crate} depends on ${resolved}`,
        ).toBe(true);
      }
    }
  });
});
