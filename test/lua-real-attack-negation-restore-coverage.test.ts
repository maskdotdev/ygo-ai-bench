import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const attackNegationFixtureCount = 7;
const attackNegationKindCounts = {
  counterTriggerNegate: 1,
  damageReflectNegate: 1,
  lpRecoverNegate: 1,
  monsterTriggerNegate: 1,
  phaseSkipNegate: 2,
  setAgainNegate: 1,
} satisfies Record<AttackNegationKind, number>;

type AttackNegationKind =
  | "counterTriggerNegate"
  | "damageReflectNegate"
  | "lpRecoverNegate"
  | "monsterTriggerNegate"
  | "phaseSkipNegate"
  | "setAgainNegate";

describe("Lua real attack negation restore coverage", () => {
  it("requires representative attack-negation fixtures to assert clean Lua restore and legal-action parity", () => {
    const files = realScriptAttackNegationFixtureFiles();
    expect(files).toHaveLength(attackNegationFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("applyLuaRestoreResponse")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires attack-negation fixtures to prove restored attack cleanup and script-specific outcomes", () => {
    const files = realScriptAttackNegationFixtureFiles();
    expect(files).toHaveLength(attackNegationFixtureCount);

    const missing = files
      .filter(({ file, outcome }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("pendingBattle).toBeUndefined()")
          || !text.includes("currentAttack).toBeUndefined()")
          || !text.includes("attackCanceledUids).toEqual")
          || outcome.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps attack-negation fixture kinds explicit", () => {
    expect(countAttackNegationKinds(realScriptAttackNegationFixtureFiles())).toEqual(attackNegationKindCounts);
  });
});

function realScriptAttackNegationFixtureFiles(): Array<{
  file: string;
  kind: AttackNegationKind;
  required: string[];
  outcome: string[];
}> {
  return ([
    {
      file: "lua-real-script-wind-up-knight-battle-target-negate.test.ts",
      kind: "monsterTriggerNegate",
      required: [
        'action.type === "activateTrigger" && action.uid === knight!.uid',
        "pendingTriggers",
        "opponentOptional",
        'eventName: "battleTargeted"',
      ],
      outcome: [
        "attackCanceledUids).toEqual([attacker!.uid])",
        'eventName: "attackDisabled"',
        'location: "monsterZone", controller: 1',
      ],
    },
    {
      file: "lua-real-script-negate-attack-battle-window.test.ts",
      kind: "phaseSkipNegate",
      required: [
        'action.type === "activateEffect" && action.uid === negateAttack!.uid',
        'phase: "battle", waitingFor: 1, windowKind: "battle"',
      ],
      outcome: [
        "attackCanceledUids).toEqual([firstAttacker!.uid])",
        'location: "graveyard"',
        "skippedPhases).toEqual([{ player: 0, phase: \"battle\", remaining: 1 }])",
      ],
    },
    {
      file: "lua-real-script-magic-cylinder-battle-window.test.ts",
      kind: "damageReflectNegate",
      required: [
        'action.type === "activateEffect" && action.uid === magicCylinder!.uid',
        'eventName": "attackDeclared"',
      ],
      outcome: [
        "attackCanceledUids).toEqual([attacker!.uid])",
        'location: "graveyard"',
        "players[0].lifePoints).toBe(6200)",
      ],
    },
    {
      file: "lua-real-script-draining-shield-battle-window.test.ts",
      kind: "lpRecoverNegate",
      required: [
        'action.type === "activateEffect" && action.uid === drainingShield!.uid',
        'eventName": "attackDeclared"',
      ],
      outcome: [
        "attackCanceledUids).toEqual([attacker!.uid])",
        'location: "graveyard"',
        "players[1].lifePoints).toBe(9800)",
      ],
    },
    {
      file: "lua-real-script-scrap-iron-scarecrow-battle-window.test.ts",
      kind: "setAgainNegate",
      required: [
        "chainResponderScript",
        'action.type === "activateEffect" && action.uid === scarecrow!.uid',
      ],
      outcome: [
        "attackCanceledUids).toEqual([attacker!.uid])",
        'location: "spellTrapZone", position: "faceDown", faceUp: false',
        'host.messages).not.toContain("scrap-iron responder resolved")',
      ],
    },
    {
      file: "lua-real-script-super-junior-confrontation-calculate-damage.test.ts",
      kind: "phaseSkipNegate",
      required: [
        'action.type === "activateEffect" && action.uid === confrontation!.uid',
        'battleWindow?.kind).toBe("attackNegationResponse")',
      ],
      outcome: [
        "attackCanceledUids).toEqual([attacker!.uid])",
        "skippedPhases).toEqual([{ player: 1, phase: \"battle\", remaining: 1 }])",
        "battleDamage).toEqual({ 0: 0, 1: 0 })",
        'eventName: "attackDisabled"',
      ],
    },
    {
      file: "lua-real-script-totem-pole-attack-negate-counter.test.ts",
      kind: "counterTriggerNegate",
      required: [
        'action.type === "activateTrigger" && action.uid === totemPole!.uid',
        "pendingTriggers",
        "opponentOptional",
      ],
      outcome: [
        "attackCanceledUids).toEqual([attacker!.uid])",
        "counters: { [0x20f]: 1 }",
        'eventName: "attackDisabled"',
        'eventName: "counterAdded"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: AttackNegationKind;
    required: string[];
    outcome: string[];
  }>)
    .map(({ file, kind, required, outcome }) => ({ file: path.join("test", file), kind, required, outcome }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function countAttackNegationKinds(
  fixtures: Array<{ kind: AttackNegationKind }>,
): Record<AttackNegationKind, number> {
  return fixtures.reduce<Record<AttackNegationKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      counterTriggerNegate: 0,
      damageReflectNegate: 0,
      lpRecoverNegate: 0,
      monsterTriggerNegate: 0,
      phaseSkipNegate: 0,
      setAgainNegate: 0,
    },
  );
}
