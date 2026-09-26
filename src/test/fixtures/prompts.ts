import type { PromptRecord } from "@/lib/stellar/promptHashClient";

let promptSequence = 1n;

/**
 * Resets the auto-incrementing prompt id sequence used by {@link makePrompt}
 * when no explicit `id` override is given. Call in `beforeEach` for isolation.
 */
export function resetPromptSequence(nextId: bigint = 1n): void {
  promptSequence = nextId;
}

export function makePrompt(
  overrides: Partial<PromptRecord> = {},
): PromptRecord {
  const { id, ...rest } = overrides;
  const nextId = id ?? promptSequence++;
  return {
    id: nextId,
    creator: "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
    imageUrl: "https://example.com/prompt.png",
    title: "Board-ready launch plan",
    category: "Marketing",
    previewText: "Public preview text for the listing.",
    description: "A paid prompt that helps teams plan launch timelines and cross-functional delivery.",
    tags: ["Marketing", "Launch"],
    encryptedPrompt: "ciphertext",
    encryptionIv: "iv",
    wrappedKey: "wrapped-key",
    contentHash: "a".repeat(64),
    priceStroops: 2_5000000n,
    active: true,
    salesCount: 4,
    ...rest,
  };
}

/**
 * Builds a batch of distinct prompt fixture records with sequential ids
 * unless an explicit `id` is supplied per item.
 */
export function makePromptList(
  count: number,
  overrides: Partial<PromptRecord> | ((index: number) => Partial<PromptRecord>) = {},
): PromptRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const itemOverrides =
      typeof overrides === "function" ? overrides(index) : overrides;
    return makePrompt(itemOverrides);
  });
}
