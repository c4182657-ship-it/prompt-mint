import { existsSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ErrorCode, ERROR_MESSAGES } from "@/lib/api/errorCodes";
import { CONTRACT_ERROR_CODES } from "@/lib/stellar/promptHashClient";

/**
 * Keeps docs/sdk-error-codes.md (Issue #776) in sync with the constants the
 * API actually ships, so a new code cannot be added without a row on the card.
 */

const ROOT = path.resolve(__dirname, "../../..");
const CARD = path.join(ROOT, "docs/sdk-error-codes.md");
const card = readFileSync(CARD, "utf8");

function section(title: string): string {
  const heading = `## ${title}`;
  const start = card.indexOf(heading);
  expect(start, `section "${title}" is missing`).toBeGreaterThan(-1);
  const rest = card.slice(start + heading.length);
  const end = rest.indexOf("\n## ");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("SDK error-code reference card", () => {
  it("documents every serverless ErrorCode constant", () => {
    const missing = Object.keys(ErrorCode).filter(
      (code) => !card.includes(`\`${code}\``),
    );

    expect(missing, "codes missing from docs/sdk-error-codes.md").toEqual([]);
  });

  it("documents every user-facing ERROR_MESSAGES entry", () => {
    const missing = Object.keys(ERROR_MESSAGES).filter(
      (code) => !card.includes(`\`${code}\``),
    );

    expect(
      missing,
      "messages missing from docs/sdk-error-codes.md",
    ).toEqual([]);
  });

  it("documents every contract error classification", () => {
    const missing = Object.keys(CONTRACT_ERROR_CODES).filter(
      (code) => !card.includes(`\`${code}\``),
    );

    expect(missing, "contract codes missing from the card").toEqual([]);
  });

  it("describes both response envelopes field by field", () => {
    expect(card).toContain("`apiVersion`");
    expect(card).toContain("`error`");
    expect(card).toContain("`code`");
    expect(card).toContain("`reset`");
    expect(card).toContain("unix ms");
    expect(card).toContain("`Accept-Version`");
  });

  it("covers the Express AppError codes the server actually throws", () => {
    for (const code of [
      "NOT_FOUND",
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "CONCURRENT_VERSION_CONFLICT",
      "KEY_NOT_FOUND",
      "EXPORT_EXPIRED",
      "CHALLENGE_MALFORMED",
      "CHALLENGE_MISMATCH",
      "INVALID_WALLET",
      "INVALID_VERSION",
    ]) {
      expect(card, `missing Express code ${code}`).toContain(`\`${code}\``);
    }
  });

  it("covers API key, idempotency, and webhook verification surfaces", () => {
    expect(card).toContain("Missing API key.");
    expect(card).toContain("still being processed");
    expect(card).toContain("X-PromptHash-Signature");
    expect(card).toContain("sha256=");
    expect(card).toContain("pm_<prefix>_<secret>");
  });

  it("marks every code in the retry tables as retryable or not", () => {
    for (const title of ["Serverless error codes", "Express API error codes"]) {
      const rows = section(title)
        .split("\n")
        .filter((line) => line.startsWith("| `"));

      expect(rows.length, `no rows in "${title}"`).toBeGreaterThan(0);
      for (const row of rows) {
        expect(
          /\|\s*(yes|no)\s*\|/.test(row),
          `retryable column missing on: ${row}`,
        ).toBe(true);
      }
    }
  });

  it("links to files that exist", () => {
    const links = [...card.matchAll(/\]\((\.\.?\/[^)#]+)\)/g)].map((m) => m[1]);

    expect(links.length).toBeGreaterThan(0);
    for (const link of new Set(links)) {
      expect(
        existsSync(path.resolve(path.dirname(CARD), link)),
        `broken link: ${link}`,
      ).toBe(true);
    }
  });
});
