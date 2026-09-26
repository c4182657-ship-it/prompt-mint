import { beforeEach, describe, expect, it } from "vitest";
import {
  makePrompt,
  makePromptList,
  resetPromptSequence,
} from "@/test/fixtures/prompts";

describe("Prompt fixture factory (Issue #795)", () => {
  beforeEach(() => {
    resetPromptSequence();
  });

  it("should return sane defaults for a prompt record", () => {
    const prompt = makePrompt();

    expect(prompt.id).toBe(1n);
    expect(prompt.title).toBe("Board-ready launch plan");
    expect(prompt.active).toBe(true);
    expect(prompt.priceStroops).toBe(2_5000000n);
    expect(prompt.contentHash).toHaveLength(64);
    expect(prompt.tags).toContain("Marketing");
  });

  it("should apply overrides without mutating defaults", () => {
    const prompt = makePrompt({ id: 42n, title: "Custom", active: false });

    expect(prompt.id).toBe(42n);
    expect(prompt.title).toBe("Custom");
    expect(prompt.active).toBe(false);
    expect(makePrompt().title).toBe("Board-ready launch plan");
  });

  it("should auto-increment ids when no explicit id is given", () => {
    const first = makePrompt();
    const second = makePrompt();
    const explicit = makePrompt({ id: 99n });
    const third = makePrompt();

    expect(first.id).toBe(1n);
    expect(second.id).toBe(2n);
    expect(explicit.id).toBe(99n);
    expect(third.id).toBe(3n);
  });

  it("should build batches with distinct ids", () => {
    const prompts = makePromptList(3);

    expect(prompts).toHaveLength(3);
    expect(prompts.map((p) => p.id)).toEqual([1n, 2n, 3n]);

    const custom = makePromptList(2, (index) => ({
      title: `Prompt ${index}`,
      active: index === 0,
    }));
    expect(custom[0].title).toBe("Prompt 0");
    expect(custom[0].active).toBe(true);
    expect(custom[1].active).toBe(false);
  });

  it("should reset the sequence for test isolation", () => {
    expect(makePrompt().id).toBe(1n);
    resetPromptSequence(10n);
    expect(makePrompt().id).toBe(10n);
  });
});
