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

const openFastResponsePlayerFixtureFileCount = 431;
const openFastWaitingForTurnPlayerProofCount = 1380;
const openFastWaitingForOpponentProofCount = 823;
const openFastBattleWindowTurnPlayerResponseProofCount = 127;
const openFastBattleWindowOpponentResponseProofCount = 188;
const openFastChainPassesEvidenceFixtureFileCount = 421;
const openFastPassHandoffFixtureFileCount = 318;
const openFastPassHandoffChainPassesFixtureFileCount = 318;
const openFastPassResolutionFixtureFileCount = 62;
const openFastPassResolutionCleanPassesFixtureFileCount = 62;
const openFastChainResolutionFixtureFileCount = 49;
const openFastChainResolutionCleanPassesFixtureFileCount = 49;
const openFastFixtureFamilyCounts = {
  baseTriggerlessAction: 34,
  battleQuickEffect: 51,
  chainEnded: 48,
  chainResolutionSegoc: 16,
  damageStepQuickEffect: 2,
  genericOpenFast: 40,
  phaseTransition: 68,
  postActionHandoff: 140,
  triggerChain: 31,
  triggerOrdering: 1,
} satisfies Record<OpenFastFixtureFamily, number>;

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

const chainEndedUntilChainEndContinuedResponseFiles = [
  "test/parity-chain-ended-open-fast-chain-response-turn-response-until-chain-end-limit-followup-pass-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-chain-response-until-chain-end-limit-followup-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-opponent-response-until-chain-end-limit-followup-pass-resolution-fixture.test.ts",
  "test/parity-chain-ended-open-fast-pass-handoff-opponent-response-turn-response-opponent-response-until-chain-end-limit-followup-resolution-fixture.test.ts",
] as const;

describe("EDOPro open fast-effect fixture coverage", () => {
  it("keeps the open-fast parity fixture inventory ratcheted", () => {
    expect(allRequiredParityOpenFastFiles()).toHaveLength(333);
  });

  it("keeps the open-fast lower-level restore test inventory ratcheted", () => {
    expect(allRequiredOpenFastRestoreFiles()).toHaveLength(18);
  });

  it("keeps chain-ended open fast-effect windows pinned to chain-response and handoff fixtures", () => {
    expect(chainEndedOpenFastFiles).toHaveLength(48);

    const missing = chainEndedOpenFastFiles.filter((file) => !fs.existsSync(path.join(root, file)));

    expect(missing).toEqual([]);
  });

  it("keeps every chain-ended open fast-effect fixture in the explicit inventory", () => {
    const scannedFiles = fs.readdirSync(path.join(root, "test"))
      .filter((file) => /^parity-chain-ended-open-fast-.*\.test\.ts$/.test(file))
      .map((file) => `test/${file}`)
      .sort();

    expect(scannedFiles).toEqual([...chainEndedOpenFastFiles].sort());
  });

  it("requires chain-ended until-chain-end limits to prove continued allowed-player response windows", () => {
    expect(chainEndedUntilChainEndContinuedResponseFiles).toHaveLength(4);

    const missing = chainEndedUntilChainEndContinuedResponseFiles.filter((file) => !fs.existsSync(path.join(root, file)));
    const weak = chainEndedUntilChainEndContinuedResponseFiles.filter((file) => !hasUntilChainEndContinuedAllowedResponseProof(file));

    expect(missing).toEqual([]);
    expect(weak).toEqual([]);
  });

  it("keeps triggerless action families pinned to base, chain-response, and restored pass-handoff fixtures", () => {
    const missing = triggerlessOpenFastFamilies.flatMap(({ base, post, restore }) =>
      requiredFiles(base, post, restore).filter((file) => !fs.existsSync(path.join(root, file))),
    );

    expect(missing).toEqual([]);
  });

  it("keeps every triggerless post-action open fast-effect fixture in its explicit family inventory", () => {
    const mismatched = triggerlessOpenFastFamilies.flatMap(({ post }) => {
      const scannedFiles = fs.readdirSync(path.join(root, "test"))
        .filter((file) => file.startsWith(`parity-post-${post}-open-fast-`) && file.endsWith(".test.ts"))
        .map((file) => `test/${file}`)
        .sort();
      const expectedFiles = requiredPostHandoffFiles(post).sort();

      return JSON.stringify(scannedFiles) === JSON.stringify(expectedFiles) ? [] : [post];
    });

    expect(mismatched).toEqual([]);
  });

  it("keeps battle sub-window quick-effect families pinned to chain, handoff, and limit fixtures", () => {
    const missing = battleQuickEffectFamilies.flatMap(({ base, kind }) =>
      requiredBattleQuickFiles(base, kind).filter((file) => !fs.existsSync(path.join(root, file))),
    );

    expect(missing).toEqual([]);
  });

  it("keeps every battle sub-window quick-effect fixture in its explicit family inventory", () => {
    const mismatched = battleQuickEffectFamilies.flatMap(({ base, kind }) => {
      const scannedFiles = fs.readdirSync(path.join(root, "test"))
        .filter((file) => file.startsWith(`parity-${base}`) && file.endsWith(".test.ts") && !file.endsWith("-coverage.test.ts"))
        .map((file) => `test/${file}`)
        .sort();
      const expectedFiles = requiredBattleQuickFiles(base, kind).sort();

      return JSON.stringify(scannedFiles) === JSON.stringify(expectedFiles) ? [] : [base];
    });

    expect(mismatched).toEqual([]);
  });

  it("keeps phase-transition open fast-effect families pinned to chain, handoff, and limit fixtures", () => {
    const missing = phaseOpenFastFamilies.flatMap(({ base, restore }) =>
      requiredPhaseOpenFastFiles(base, restore).filter((file) => !fs.existsSync(path.join(root, file))),
    );

    expect(missing).toEqual([]);
  });

  it("keeps every phase-transition open fast-effect fixture in its explicit family inventory", () => {
    const mismatched = phaseOpenFastFamilies.flatMap(({ base, restore }) => {
      const scannedFiles = phaseTransitionOpenFastFiles(base);
      const expectedFiles = requiredPhaseOpenFastFiles(base, restore)
        .filter((file) => path.basename(file).startsWith("parity-"))
        .sort();

      return JSON.stringify(scannedFiles) === JSON.stringify(expectedFiles) ? [] : [base];
    });

    expect(mismatched).toEqual([]);
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

  it("keeps open-fast response-player evidence ratcheted", () => {
    const files = allOpenFastResponsePlayerFixtureFiles();
    const evidence = countResponsePlayerEvidence(files);

    expect(files).toHaveLength(openFastResponsePlayerFixtureFileCount);
    expect(evidence).toEqual({
      waitingForTurnPlayer: openFastWaitingForTurnPlayerProofCount,
      waitingForOpponent: openFastWaitingForOpponentProofCount,
      battleWindowTurnPlayerResponse: openFastBattleWindowTurnPlayerResponseProofCount,
      battleWindowOpponentResponse: openFastBattleWindowOpponentResponseProofCount,
    });
  });

  it("keeps open-fast fixture families explicit", () => {
    expect(countOpenFastFixtureFamilies(allOpenFastResponsePlayerFixtureFiles())).toEqual(openFastFixtureFamilyCounts);
  });

  it("requires every open-fast response-player fixture to carry parity proof metadata", () => {
    const files = allOpenFastResponsePlayerFixtureFiles();
    const weak = files.filter((file) =>
      !hasRawAndGroupedLegalActionProof(file)
        || !hasAbsentRawAndGroupedLegalActionProof(file)
        || !hasSnapshotRestoreProof(file)
        || !hasPublicWindowIdentityProof(file)
        || !hasEdoproProvenanceNote(file),
    );

    expect(files).toHaveLength(openFastResponsePlayerFixtureFileCount);
    expect(weak).toEqual([]);
  });

  it("keeps open-fast pass handoff and resolution evidence ratcheted", () => {
    const files = allOpenFastResponsePlayerFixtureFiles();
    const evidence = countOpenFastHandoffEvidence(files);

    expect(files).toHaveLength(openFastResponsePlayerFixtureFileCount);
    expect(evidence).toEqual({
      chainPassesEvidenceFiles: openFastChainPassesEvidenceFixtureFileCount,
      passHandoffFiles: openFastPassHandoffFixtureFileCount,
      passHandoffChainPassesFiles: openFastPassHandoffChainPassesFixtureFileCount,
      passResolutionFiles: openFastPassResolutionFixtureFileCount,
      passResolutionCleanPassesFiles: openFastPassResolutionCleanPassesFixtureFileCount,
      chainResolutionFiles: openFastChainResolutionFixtureFileCount,
      chainResolutionCleanPassesFiles: openFastChainResolutionCleanPassesFixtureFileCount,
    });
  });

  it("requires open-fast fixture windows to carry EDOPro provenance notes", () => {
    const weak = allRequiredParityOpenFastFiles().filter((file) => !hasEdoproProvenanceNote(file));

    expect(weak).toEqual([]);
  });
});

type OpenFastFixtureFamily =
  | "baseTriggerlessAction"
  | "battleQuickEffect"
  | "chainEnded"
  | "chainResolutionSegoc"
  | "damageStepQuickEffect"
  | "genericOpenFast"
  | "phaseTransition"
  | "postActionHandoff"
  | "triggerChain"
  | "triggerOrdering";

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
    `test/parity-post-${post}-open-fast-pass-handoff-turn-response-fixture.test.ts`,
    `test/parity-post-${post}-open-fast-pass-handoff-turn-response-chain-limit-fixture.test.ts`,
    `test/parity-post-${post}-open-fast-pass-handoff-turn-response-until-chain-end-limit-fixture.test.ts`,
    `test/parity-post-${post}-open-fast-pass-handoff-opponent-response-chain-limit-fixture.test.ts`,
    `test/parity-post-${post}-open-fast-pass-handoff-opponent-response-until-chain-end-limit-fixture.test.ts`,
    `test/parity-post-${post}-open-fast-pass-handoff-opponent-response-turn-response-chain-fixture.test.ts`,
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
          ...(kind === "opponent" || kind === "timing-opponent" ? [`test/parity-${base}-pass-handoff-response-turn-response-chain-pass-resolution-fixture.test.ts`] : []),
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
    ...existingBattleQuickFiles(base, [
      ...(kind === "turn" || kind === "opponent" ? [`test/parity-${base}-chained-return-fixture.test.ts`] : []),
      ...(kind === "turn" || kind === "timing-turn"
        ? [
            `test/parity-${base}-pass-handoff-turn-response-fixture.test.ts`,
            `test/parity-${base}-pass-handoff-turn-response-chain-limit-fixture.test.ts`,
            `test/parity-${base}-pass-handoff-turn-response-until-chain-end-limit-fixture.test.ts`,
          ]
        : []),
    ]),
    ...handoff,
    ...limits,
  ];
}

function existingBattleQuickFiles(base: string, files: string[]): string[] {
  return files.filter((file) => path.basename(file).startsWith(`parity-${base}`) && fs.existsSync(path.join(root, file)));
}

function requiredPhaseOpenFastFiles(base: string, restore: string): string[] {
  return [
    ...phaseTransitionOpenFastFiles(base),
    `test/duel-${restore}-open-fast-pass-handoff-restore.test.ts`,
  ];
}

function phaseTransitionOpenFastFiles(base: string): string[] {
  return fs.readdirSync(path.join(root, "test"))
    .filter((file) => file.startsWith(`parity-${base}`) && file.endsWith(".test.ts") && !file.endsWith("-coverage.test.ts"))
    .map((file) => `test/${file}`)
    .sort();
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

function allOpenFastResponsePlayerFixtureFiles(): string[] {
  return fs.readdirSync(path.join(root, "test"))
    .filter((file) => file.startsWith("parity-") && file.endsWith(".test.ts"))
    .filter((file) => !file.endsWith("-coverage.test.ts"))
    .filter((file) => file.includes("open-fast") || file.includes("quick-effect"))
    .map((file) => `test/${file}`)
    .sort();
}

function countResponsePlayerEvidence(files: string[]): {
  waitingForTurnPlayer: number;
  waitingForOpponent: number;
  battleWindowTurnPlayerResponse: number;
  battleWindowOpponentResponse: number;
} {
  return files.reduce((counts, file) => {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    counts.waitingForTurnPlayer += text.match(/waitingFor:\s*0/g)?.length ?? 0;
    counts.waitingForOpponent += text.match(/waitingFor:\s*1/g)?.length ?? 0;
    counts.battleWindowTurnPlayerResponse += text.match(/responsePlayer:\s*0/g)?.length ?? 0;
    counts.battleWindowOpponentResponse += text.match(/responsePlayer:\s*1/g)?.length ?? 0;
    return counts;
  }, {
    waitingForTurnPlayer: 0,
    waitingForOpponent: 0,
    battleWindowTurnPlayerResponse: 0,
    battleWindowOpponentResponse: 0,
  });
}

function countOpenFastHandoffEvidence(files: string[]): {
  chainPassesEvidenceFiles: number;
  passHandoffFiles: number;
  passHandoffChainPassesFiles: number;
  passResolutionFiles: number;
  passResolutionCleanPassesFiles: number;
  chainResolutionFiles: number;
  chainResolutionCleanPassesFiles: number;
} {
  return files.reduce((counts, file) => {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const hasChainPasses = /chainPasses:\s*\[/.test(text);
    const hasCleanChainPasses = /chainPasses:\s*\[\]/.test(text);
    const isPassHandoff = file.includes("pass-handoff");
    const isPassResolution = file.includes("pass-resolution");
    const isChainResolution = file.includes("chain-resolution");
    if (hasChainPasses) counts.chainPassesEvidenceFiles += 1;
    if (isPassHandoff) counts.passHandoffFiles += 1;
    if (isPassHandoff && hasChainPasses) counts.passHandoffChainPassesFiles += 1;
    if (isPassResolution) counts.passResolutionFiles += 1;
    if (isPassResolution && hasCleanChainPasses) counts.passResolutionCleanPassesFiles += 1;
    if (isChainResolution) counts.chainResolutionFiles += 1;
    if (isChainResolution && hasCleanChainPasses) counts.chainResolutionCleanPassesFiles += 1;
    return counts;
  }, {
    chainPassesEvidenceFiles: 0,
    passHandoffFiles: 0,
    passHandoffChainPassesFiles: 0,
    passResolutionFiles: 0,
    passResolutionCleanPassesFiles: 0,
    chainResolutionFiles: 0,
    chainResolutionCleanPassesFiles: 0,
  });
}

function countOpenFastFixtureFamilies(files: string[]): Record<OpenFastFixtureFamily, number> {
  return files.reduce<Record<OpenFastFixtureFamily, number>>(
    (counts, file) => {
      counts[classifyOpenFastFixtureFamily(file)] += 1;
      return counts;
    },
    {
      baseTriggerlessAction: 0,
      battleQuickEffect: 0,
      chainEnded: 0,
      chainResolutionSegoc: 0,
      damageStepQuickEffect: 0,
      genericOpenFast: 0,
      phaseTransition: 0,
      postActionHandoff: 0,
      triggerChain: 0,
      triggerOrdering: 0,
    },
  );
}

function classifyOpenFastFixtureFamily(file: string): OpenFastFixtureFamily {
  const basename = path.basename(file);
  if (basename.startsWith("parity-chain-ended-open-fast-")) return "chainEnded";
  if (basename.startsWith("parity-trigger-chain-open-fast-")) return "triggerChain";
  if (basename.startsWith("parity-chain-resolution-segoc-")) return "chainResolutionSegoc";
  if (basename.includes("battle-") && basename.includes("quick-effect")) return "battleQuickEffect";
  if (basename.startsWith("parity-main2-open-fast-") || basename.startsWith("parity-end-turn-open-fast-") || basename.startsWith("parity-main2-phase-open-fast-")) return "phaseTransition";
  if (basename.startsWith("parity-post-")) return "postActionHandoff";
  if (/^parity-(normal-summon|tribute-summon|tribute-set|special-summon|fusion-summon|synchro-summon|xyz-summon|link-summon|ritual-summon|monster-set|flip-summon|pendulum-summon|spell-trap-set|position)-open-fast/.test(basename)) return "baseTriggerlessAction";
  if (basename.startsWith("parity-open-fast-")) return "genericOpenFast";
  if (basename.startsWith("parity-mandatory-before-optional-")) return "triggerOrdering";
  if (
    basename === "parity-damage-step-only-quick-effect-fixture.test.ts" ||
    basename === "parity-unflagged-damage-step-quick-effect-fixture.test.ts"
  ) {
    return "damageStepQuickEffect";
  }
  throw new Error(`Unclassified open-fast fixture: ${file}`);
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

function hasPublicWindowIdentityProof(file: string): boolean {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  return (
    /source:\s*["']edopro["']/.test(text) &&
    /windowId:\s*\d+/.test(text) &&
    /windowKind:\s*["'](?:open|chainResponse|battle)["']/.test(text)
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

function hasUntilChainEndContinuedAllowedResponseProof(file: string): boolean {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  return (
    /source:\s*["']edopro["']/.test(text) &&
    /SetChainLimitTillChainEnd/.test(text) &&
    /chainLimits:\s*\[\{\s*untilChainEnd:\s*true\s*\}\]/.test(text) &&
    /waitingFor:\s*0/.test(text) &&
    /legalActions:\s*\[[\s\S]*type:\s*["']activateEffect["'],\s*player:\s*0[\s\S]*type:\s*["']passChain["'],\s*player:\s*0/.test(text)
  );
}

function hasEdoproProvenanceNote(file: string): boolean {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  return (
    /source:\s*["']edopro["']/.test(text) &&
    /note:\s*["'][^"']*EDOPro/.test(text)
  );
}
