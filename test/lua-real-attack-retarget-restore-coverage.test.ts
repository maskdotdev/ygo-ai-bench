import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const attackRetargetFixtureCount = 6;
const attackRetargetKindCounts = {
  directAttackConversion: 1,
  selectedTargetRetarget: 1,
  selfRetarget: 1,
  summonRetarget: 3,
} satisfies Record<AttackRetargetKind, number>;

type AttackRetargetKind = "directAttackConversion" | "selectedTargetRetarget" | "selfRetarget" | "summonRetarget";

describe("Lua real attack retarget restore coverage", () => {
  it("requires representative attack-retarget fixtures to assert clean Lua restore and replayed target changes", () => {
    const files = realScriptAttackRetargetFixtureFiles();
    expect(files).toHaveLength(attackRetargetFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("currentAttack")
          || !text.includes("pendingBattle")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps attack-retarget fixture kinds explicit", () => {
    expect(countAttackRetargetKinds(realScriptAttackRetargetFixtureFiles())).toEqual(attackRetargetKindCounts);
  });
});

function realScriptAttackRetargetFixtureFiles(): Array<{
  file: string;
  kind: AttackRetargetKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-apple-magician-girl-attack-retarget.test.ts",
      kind: "summonRetarget",
      required: [
        'eventName: "battleTargeted"',
        "targetUid: spellcaster.uid",
        "battleDamage).toMatchObject({ 1: 400 })",
      ],
    },
    {
      file: "test/lua-real-script-card-blocker-change-attack-target.test.ts",
      kind: "selfRetarget",
      required: [
        "effectId.endsWith(\"-1131\")",
        "targetUid: blocker!.uid",
        "battleDamage).toMatchObject({ 1: 1400 })",
      ],
    },
    {
      file: "test/lua-real-script-call-earthbound-change-attack-target.test.ts",
      kind: "selectedTargetRetarget",
      required: [
        'action.type === "activateEffect"',
        "targetUid: newTarget!.uid",
        "battleDamage).toMatchObject({ 1: 1300 })",
      ],
    },
    {
      file: "test/lua-real-script-chocolate-magician-girl-retarget.test.ts",
      kind: "summonRetarget",
      required: [
        'eventName: "battleTargeted"',
        "targetUid: spellcaster!.uid",
        "battleDamage).toMatchObject({ 1: 400 })",
      ],
    },
    {
      file: "test/lua-real-script-toon-defense-change-attack-target.test.ts",
      kind: "directAttackConversion",
      required: [
        'eventName: "attackDeclared"',
        "currentAttack?.targetUid).toBeUndefined()",
        "battleDamage).toMatchObject({ 1: 1800 })",
      ],
    },
    {
      file: "test/lua-real-script-ultimate-divine-beast-retarget.test.ts",
      kind: "summonRetarget",
      required: [
        'eventName: "attackDeclared"',
        "targetUid: divine!.uid",
        "battleWindow?.kind).not.toBe(\"replayDecision\")",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: AttackRetargetKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countAttackRetargetKinds(fixtures: Array<{ kind: AttackRetargetKind }>): Record<AttackRetargetKind, number> {
  return fixtures.reduce<Record<AttackRetargetKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      directAttackConversion: 0,
      selectedTargetRetarget: 0,
      selfRetarget: 0,
      summonRetarget: 0,
    },
  );
}
