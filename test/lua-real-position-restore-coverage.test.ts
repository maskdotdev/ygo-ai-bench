import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const POSITION_FIXTURE_COUNT = 5;
const positionKindCounts = {
  banishCostGroupChange: 1,
  battlePhaseSelfDefenseLock: 1,
  overlayTargetChange: 1,
  summonTriggerAttackPosition: 1,
  summonTriggerSet: 1,
} satisfies Record<PositionKind, number>;
const positionSemanticVariantCounts = {
  angineerDetachOverlayProtectedPositionChange: 1,
  gagagaEscapeBanishCostGroupPositionChange: 1,
  goblinAttackForceBattlePhasePositionLock: 1,
  otohimeSummonTriggerAttackPosition: 1,
  tsukuyomiSpiritSummonFaceDownSet: 1,
} satisfies Record<PositionSemanticVariant, number>;

type PositionKind = "banishCostGroupChange" | "battlePhaseSelfDefenseLock" | "overlayTargetChange" | "summonTriggerAttackPosition" | "summonTriggerSet";
type PositionSemanticVariant =
  | "angineerDetachOverlayProtectedPositionChange"
  | "gagagaEscapeBanishCostGroupPositionChange"
  | "goblinAttackForceBattlePhasePositionLock"
  | "otohimeSummonTriggerAttackPosition"
  | "tsukuyomiSpiritSummonFaceDownSet";

describe("Lua real position restore coverage", () => {
  it("requires position-changing summon triggers to assert clean Lua registry restore and restored outcomes", () => {
    const files = positionFixtureFiles();
    expect(files).toHaveLength(POSITION_FIXTURE_COUNT);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("eventHistory")
          || !text.includes('eventName: "positionChanged"')
          || !text.includes("host.messages).not.toContain")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps position fixture kinds explicit", () => {
    expect(countPositionKinds(positionFixtureFiles())).toEqual(positionKindCounts);
  });

  it("keeps named position semantic variants explicit", () => {
    expect(countPositionSemanticVariants(positionSemanticVariants())).toEqual(positionSemanticVariantCounts);

    const weak = positionSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps position fixtures script-gated and database-independent", () => {
    const weak = positionSemanticVariants()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return text.includes("readDatabaseCards")
          || text.includes("hasUpstreamDatabase")
          || !text.includes("workspace.readScript")
          || !text.includes("describe.skipIf(!hasUpstreamScripts || !has");
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function positionFixtureFiles(): Array<{
  file: string;
  kind: PositionKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-angineer-overlay-position.test.ts",
      kind: "overlayTargetChange",
      required: [
        "targetUids: [target!.uid]",
        'eventName: "detachedMaterial"',
        "positionsChanged).toEqual([target!.uid])",
        "overlayUids: []",
      ],
    },
    {
      file: "test/lua-real-script-gagaga-escape-position-lockout.test.ts",
      kind: "banishCostGroupChange",
      required: [
        "category: 0x1000",
        "positionsChanged).toEqual([changed!.uid, eligible!.uid])",
        'eventName: "banished"',
        'position: "faceUpDefense", faceUp: true',
      ],
    },
    {
      file: "test/lua-real-script-goblin-force-position-lock.test.ts",
      kind: "battlePhaseSelfDefenseLock",
      required: [
        "Duel.ChangePosition(c,POS_FACEUP_DEFENSE)",
        "EFFECT_CANNOT_CHANGE_POSITION",
        "EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_COPY_INHERIT",
        "e1:SetReset(RESETS_STANDARD_PHASE_END,3)",
        'eventName: "phaseBattle"',
        'eventName: "positionChanged"',
        "goblin force lock false/0",
      ],
    },
    {
      file: "test/lua-real-script-otohime-position-overload.test.ts",
      kind: "summonTriggerAttackPosition",
      required: [
        "operationInfos: [{ category: 0x1000",
        "parameter: 0",
        'position: "faceUpAttack", faceUp: true',
      ],
    },
    {
      file: "test/lua-real-script-tsukuyomi-position-trigger.test.ts",
      kind: "summonTriggerSet",
      required: [
        "operationInfos: [{ category: 0x1000",
        "parameter: 0x8",
        'position: "faceDownDefense", faceUp: false',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: PositionKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countPositionKinds(fixtures: Array<{ kind: PositionKind }>): Record<PositionKind, number> {
  return fixtures.reduce<Record<PositionKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      banishCostGroupChange: 0,
      battlePhaseSelfDefenseLock: 0,
      overlayTargetChange: 0,
      summonTriggerAttackPosition: 0,
      summonTriggerSet: 0,
    },
  );
}

function positionSemanticVariants(): Array<{
  file: string;
  kind: PositionSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-angineer-overlay-position.test.ts",
      kind: "angineerDetachOverlayProtectedPositionChange",
      required: [
        'const angineerCode = "15914410"',
        "restores Angineer after detaching Xyz material and resolves its protected position change",
        'eventName: "detachedMaterial"',
      ],
    },
    {
      file: "test/lua-real-script-gagaga-escape-position-lockout.test.ts",
      kind: "gagagaEscapeBanishCostGroupPositionChange",
      required: [
        'const escapeCode = "9591819"',
        "restores Gagaga Escape and keeps IsCanChangePosition-locked Gagaga monsters unchanged",
        'eventName: "banished"',
      ],
    },
    {
      file: "test/lua-real-script-goblin-force-position-lock.test.ts",
      kind: "goblinAttackForceBattlePhasePositionLock",
      required: [
        'const goblinCode = "78658564"',
        "restores its Battle Phase self-defense change and copied cannot-change-position lock",
        "goblin force lock false/0",
      ],
    },
    {
      file: "test/lua-real-script-otohime-position-overload.test.ts",
      kind: "otohimeSummonTriggerAttackPosition",
      required: [
        'const otohimeCode = "39751093"',
        "restores its summon trigger and changes a face-up Defense target to Attack",
        'position: "faceUpAttack", faceUp: true',
      ],
    },
    {
      file: "test/lua-real-script-tsukuyomi-position-trigger.test.ts",
      kind: "tsukuyomiSpiritSummonFaceDownSet",
      required: [
        'const tsukuyomiCode = "34853266"',
        "restores its Spirit summon trigger and turns a target monster face-down",
        'position: "faceDownDefense", faceUp: false',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: PositionSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countPositionSemanticVariants(
  fixtures: Array<{ kind: PositionSemanticVariant }>,
): Record<PositionSemanticVariant, number> {
  return fixtures.reduce<Record<PositionSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      angineerDetachOverlayProtectedPositionChange: 0,
      gagagaEscapeBanishCostGroupPositionChange: 0,
      goblinAttackForceBattlePhasePositionLock: 0,
      otohimeSummonTriggerAttackPosition: 0,
      tsukuyomiSpiritSummonFaceDownSet: 0,
    },
  );
}
