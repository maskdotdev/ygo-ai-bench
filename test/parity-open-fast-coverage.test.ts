import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const triggerlessOpenFastFamilies = [
  { base: "normal-summon", post: "normal-summon", restore: "normal-summon" },
  { base: "tribute-summon", post: "tribute-summon", restore: "tribute-summon" },
  { base: "tribute-set", post: "tribute-set", restore: "tribute-set" },
  { base: "special-summon", post: "special-summon", restore: "special-summon" },
  { base: "fusion-summon", post: "fusion-summon", restore: "fusion-summon" },
  { base: "synchro-summon", post: "synchro-summon", restore: "synchro-summon" },
  { base: "xyz-summon", post: "xyz-summon", restore: "xyz-summon" },
  { base: "link-summon", post: "link-summon", restore: "link-summon" },
  { base: "ritual-summon", post: "ritual-summon", restore: "ritual-summon" },
  { base: "monster-set", post: "monster-set", restore: "monster-set" },
  { base: "flip-summon", post: "flip-summon", restore: "flip-summon" },
  { base: "pendulum-summon", post: "pendulum-summon", restore: "pendulum-summon" },
  { base: "spell-trap-set", post: "spell-trap-set", restore: "spell-trap-set" },
  { base: "position", post: "position-change", restore: "position-change" },
] as const;

const battleQuickEffectFamilies = [
  { base: "battle-quick-effect", kind: "turn" },
  { base: "battle-opponent-quick-effect", kind: "opponent" },
  { base: "battle-damage-calculation-quick-effect", kind: "turn" },
  { base: "battle-opponent-damage-calculation-quick-effect", kind: "opponent" },
  { base: "battle-before-damage-calculation-quick-effect", kind: "timing-turn" },
  { base: "battle-before-damage-calculation-opponent-quick-effect", kind: "timing-opponent" },
  { base: "battle-after-damage-calculation-quick-effect", kind: "timing-turn" },
  { base: "battle-after-damage-calculation-opponent-quick-effect", kind: "timing-opponent" },
  { base: "battle-end-damage-step-quick-effect", kind: "timing-turn" },
  { base: "battle-end-damage-step-opponent-quick-effect", kind: "timing-opponent" },
] as const;

const phaseOpenFastFamilies = [
  { base: "main2-open-fast", restore: "main2" },
  { base: "end-turn-open-fast", restore: "end-turn" },
] as const;

const chainEndedOpenFastFiles = [
  "test/parity-chain-ended-open-fast-chain-response-chain-limit-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-opponent-response-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-chain-limit-opponent-response-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-chain-limit-opponent-response-pass-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-chain-limit-opponent-response-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-opponent-response-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-opponent-response-pass-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-opponent-response-turn-response-opponent-response-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-opponent-response-turn-response-opponent-response-pass-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-opponent-response-turn-response-opponent-response-turn-response-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-opponent-response-turn-response-opponent-response-turn-response-opponent-response-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-opponent-response-turn-response-opponent-response-turn-response-opponent-response-pass-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-opponent-response-turn-response-opponent-response-turn-response-opponent-response-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-opponent-response-turn-response-opponent-response-turn-response-opponent-response-turn-response-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-opponent-response-turn-response-opponent-response-turn-response-opponent-response-turn-response-pass-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-opponent-response-turn-response-opponent-response-turn-response-opponent-response-turn-response-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-opponent-response-turn-response-opponent-response-turn-response-pass-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-opponent-response-turn-response-opponent-response-turn-response-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-opponent-response-turn-response-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-turn-response-until-chain-end-limit-followup-pass-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-until-chain-end-limit-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-until-chain-end-limit-followup-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-no-response-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-chain-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-chain-limit-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-chain-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-chain-limit-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-chain-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-chain-limit-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-chain-pass-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-chain-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-opponent-response-chain-limit-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-opponent-response-chain-limit-opponent-response-pass-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-opponent-response-chain-limit-opponent-response-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-opponent-response-chain-limit-turn-response-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-opponent-response-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-opponent-response-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-opponent-response-turn-response-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-opponent-response-until-chain-end-limit-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-opponent-response-until-chain-end-limit-followup-pass-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-opponent-response-until-chain-end-limit-followup-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-until-chain-end-limit-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-until-chain-end-limit-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-until-chain-end-limit-fixture.test.ts",
] as const;

describe("EDOPro open fast-effect fixture coverage", () => {
  it("keeps the open-fast parity fixture inventory ratcheted", () => {
    expect(allRequiredParityOpenFastFiles()).toHaveLength(240);
  });

  it("keeps the open-fast lower-level restore test inventory ratcheted", () => {
    expect(allRequiredOpenFastRestoreFiles()).toHaveLength(18);
  });

  it("keeps chain-ended open fast-effect windows pinned to chain-response and handoff fixtures", () => {
    expect(chainEndedOpenFastFiles).toHaveLength(48);

    const missing = chainEndedOpenFastFiles.filter((file) => !fs.existsSync(path.join(root, file)));

    expect(missing).toEqual([]);
  });

  it("keeps triggerless action families pinned to base, chain-response, and restored pass-handoff fixtures", () => {
    const missing = triggerlessOpenFastFamilies.flatMap(({ base, post, restore }) =>
      requiredFiles(base, post, restore).filter((file) => !fs.existsSync(path.join(root, file))),
    );

    expect(missing).toEqual([]);
  });

  it("keeps battle sub-window quick-effect families pinned to chain, handoff, and limit fixtures", () => {
    const missing = battleQuickEffectFamilies.flatMap(({ base, kind }) =>
      requiredBattleQuickFiles(base, kind).filter((file) => !fs.existsSync(path.join(root, file))),
    );

    expect(missing).toEqual([]);
  });

  it("keeps phase-transition open fast-effect families pinned to chain, handoff, and limit fixtures", () => {
    const missing = phaseOpenFastFamilies.flatMap(({ base, restore }) =>
      requiredPhaseOpenFastFiles(base, restore).filter((file) => !fs.existsSync(path.join(root, file))),
    );

    expect(missing).toEqual([]);
  });

  it("requires battle quick-effect fixtures to pin restorable EDOPro battle windows", () => {
    const weak = battleQuickEffectFamilies.flatMap(({ base, kind }) =>
      requiredBattleQuickFiles(base, kind).filter((file) => !hasRestorableBattleWindowProof(file)),
    );

    expect(weak).toEqual([]);
  });

  it("requires open-fast fixture windows to assert raw and grouped legal actions", () => {
    const weak = allRequiredParityOpenFastFiles().filter((file) => !hasRawAndGroupedLegalActionProof(file));

    expect(weak).toEqual([]);
  });

  it("requires open-fast fixture windows to assert absent raw and grouped legal actions", () => {
    const weak = allRequiredParityOpenFastFiles().filter((file) => !hasAbsentRawAndGroupedLegalActionProof(file));

    expect(weak).toEqual([]);
  });

  it("requires open-fast fixture windows to prove snapshot restore", () => {
    const weak = allRequiredParityOpenFastFiles().filter((file) => !hasSnapshotRestoreProof(file));

    expect(weak).toEqual([]);
  });

  it("requires open-fast restore tests to prove clean restored windows", () => {
    const weak = allRequiredOpenFastRestoreFiles().filter((file) => !hasCleanRestoreWindowProof(file));

    expect(weak).toEqual([]);
  });

  it("requires open-fast fixture windows to pin response player ownership", () => {
    const weak = allRequiredParityOpenFastFiles().filter((file) => !hasWaitingForProof(file));

    expect(weak).toEqual([]);
  });

  it("requires open-fast fixture windows to carry EDOPro provenance notes", () => {
    const weak = allRequiredParityOpenFastFiles().filter((file) => !hasEdoproProvenanceNote(file));

    expect(weak).toEqual([]);
  });
});

function requiredFiles(base: string, post: string, restore: string): string[] {
  return [
    `test/parity-${base}-open-fast-fixture.test.ts`,
    `test/parity-${base}-open-fast-chain-fixture.test.ts`,
    ...requiredPostHandoffFiles(post),
    `test/duel-post-${restore}-open-fast-pass-handoff-restore.test.ts`,
  ];
}

function requiredPostHandoffFiles(post: string): string[] {
  return [
    `test/parity-post-${post}-open-fast-pass-handoff-pass-resolution-fixture.test.ts`,
    `test/parity-post-${post}-open-fast-pass-handoff-turn-response-chain-limit-fixture.test.ts`,
    `test/parity-post-${post}-open-fast-pass-handoff-turn-response-until-chain-end-limit-fixture.test.ts`,
    `test/parity-post-${post}-open-fast-pass-handoff-opponent-response-chain-limit-fixture.test.ts`,
    `test/parity-post-${post}-open-fast-pass-handoff-opponent-response-until-chain-end-limit-fixture.test.ts`,
    `test/parity-post-${post}-open-fast-pass-handoff-opponent-response-turn-response-resolution-fixture.test.ts`,
    `test/parity-post-${post}-open-fast-pass-handoff-opponent-response-turn-response-chain-resolution-fixture.test.ts`,
    `test/parity-post-${post}-open-fast-pass-handoff-opponent-response-turn-response-chain-pass-resolution-fixture.test.ts`,
  ];
}

function requiredBattleQuickFiles(base: string, kind: (typeof battleQuickEffectFamilies)[number]["kind"]): string[] {
  const baseAndChain =
    kind === "turn" || kind === "opponent"
      ? [`test/parity-${base}-fixture.test.ts`, `test/parity-${base}-chain-response-fixture.test.ts`]
      : [];
  const handoff =
    kind === "turn" || kind === "timing-turn"
      ? [`test/parity-${base}-pass-handoff-turn-response-resolution-fixture.test.ts`]
      : [
          `test/parity-${base}-pass-handoff-response-resolution-fixture.test.ts`,
          ...(kind === "timing-opponent" ? [`test/parity-${base}-pass-handoff-response-turn-response-chain-pass-resolution-fixture.test.ts`] : []),
          `test/parity-${base}-pass-handoff-response-turn-response-chain-resolution-fixture.test.ts`,
        ];
  const limits =
    kind === "turn" || kind === "timing-turn"
      ? [
          `test/parity-${base}-chain-response-pass-handoff-chain-limit-fixture.test.ts`,
          `test/parity-${base}-chain-response-pass-handoff-until-chain-end-limit-fixture.test.ts`,
        ]
      : kind === "opponent"
        ? [
            `test/parity-${base}-pass-handoff-response-chain-limit-fixture.test.ts`,
            `test/parity-${base}-pass-handoff-response-until-chain-end-limit-fixture.test.ts`,
          ]
        : [];

  return [
    ...baseAndChain,
    ...handoff,
    ...limits,
  ];
}

function requiredPhaseOpenFastFiles(base: string, restore: string): string[] {
  return [
    `test/parity-${base}-pass-handoff-fixture.test.ts`,
    `test/parity-${base}-pass-handoff-chain-limit-fixture.test.ts`,
    `test/parity-${base}-pass-handoff-until-chain-end-limit-fixture.test.ts`,
    `test/parity-${base}-chain-response-pass-handoff-fixture.test.ts`,
    `test/parity-${base}-chain-response-pass-handoff-chain-limit-fixture.test.ts`,
    `test/parity-${base}-chain-response-pass-handoff-until-chain-end-limit-fixture.test.ts`,
    `test/duel-${restore}-open-fast-pass-handoff-restore.test.ts`,
  ];
}

function hasRestorableBattleWindowProof(file: string): boolean {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  return (
    /source:\s*["']edopro["']/.test(text) &&
    /snapshotRestore:\s*["']both["']/.test(text) &&
    /battleWindow:\s*\{/.test(text) &&
    /responsePlayer:\s*[01]/.test(text)
  );
}

function allRequiredParityOpenFastFiles(): string[] {
  return [...new Set([
    ...triggerlessOpenFastFamilies.flatMap(({ base, post }) => [
      `test/parity-${base}-open-fast-fixture.test.ts`,
      `test/parity-${base}-open-fast-chain-fixture.test.ts`,
      ...requiredPostHandoffFiles(post),
    ]),
    ...battleQuickEffectFamilies.flatMap(({ base, kind }) => requiredBattleQuickFiles(base, kind)),
    ...phaseOpenFastFamilies.flatMap(({ base, restore }) => requiredPhaseOpenFastFiles(base, restore)),
    ...chainEndedOpenFastFiles,
  ])].filter((file) => path.basename(file).startsWith("parity-"));
}

function allRequiredOpenFastRestoreFiles(): string[] {
  return [
    ...triggerlessOpenFastFamilies.map(({ restore }) => `test/duel-post-${restore}-open-fast-pass-handoff-restore.test.ts`),
    ...phaseOpenFastFamilies.map(({ restore }) => `test/duel-${restore}-open-fast-pass-handoff-restore.test.ts`),
    "test/duel-chain-ended-open-fast-handoff-restore.test.ts",
    "test/duel-chain-ended-open-fast-handoff-limit-restore.test.ts",
  ];
}

function hasRawAndGroupedLegalActionProof(file: string): boolean {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  return (
    /source:\s*["']edopro["']/.test(text) &&
    /legalActions:\s*\[/.test(text) &&
    /legalActionGroups:\s*\[/.test(text)
  );
}

function hasAbsentRawAndGroupedLegalActionProof(file: string): boolean {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  return (
    /source:\s*["']edopro["']/.test(text) &&
    /absentLegalActions:\s*\[/.test(text) &&
    /absentLegalActionGroups:\s*\[/.test(text)
  );
}

function hasSnapshotRestoreProof(file: string): boolean {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  return (
    /source:\s*["']edopro["']/.test(text) &&
    /snapshotRestore:\s*["']both["']/.test(text)
  );
}

function hasCleanRestoreWindowProof(file: string): boolean {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  return (
    /pendingTriggers:\s*\[\],\s*pendingTriggerBuckets:\s*\[\]/.test(text) &&
    /state\.chainPasses/.test(text) &&
    /getGroupedDuelLegalActions/.test(text) &&
    /flatMap\(\(group\) => group\.actions\)/.test(text) &&
    /not\.toContain/.test(text)
  );
}

function hasWaitingForProof(file: string): boolean {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  return (
    /source:\s*["']edopro["']/.test(text) &&
    /waitingFor:\s*[01]/.test(text)
  );
}

function hasEdoproProvenanceNote(file: string): boolean {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  return (
    /source:\s*["']edopro["']/.test(text) &&
    /note:\s*["'][^"']*EDOPro/.test(text)
  );
}
