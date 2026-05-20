import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const attackNegationFixtureCount = 8;
const attackNegationKindCounts = {
  counterTriggerNegate: 1,
  delayedGraveNegate: 1,
  damageReflectNegate: 1,
  lpRecoverNegate: 1,
  monsterTriggerNegate: 1,
  phaseSkipNegate: 2,
  setAgainNegate: 1,
} satisfies Record<AttackNegationKind, number>;
const attackNegationSemanticVariantCounts = {
  drainingShieldRecoverNegate: 1,
  magicCylinderReflectNegate: 1,
  necroGardnaDelayedNegate: 1,
  negateAttackPhaseSkip: 1,
  scrapIronSetAgainNegate: 1,
  superJuniorCalculateDamageSkip: 1,
  totemPoleCounterNegate: 1,
  windUpKnightBattleTargetNegate: 1,
} satisfies Record<AttackNegationSemanticVariant, number>;

type AttackNegationKind =
  | "counterTriggerNegate"
  | "delayedGraveNegate"
  | "damageReflectNegate"
  | "lpRecoverNegate"
  | "monsterTriggerNegate"
  | "phaseSkipNegate"
  | "setAgainNegate";

type AttackNegationSemanticVariant =
  | "drainingShieldRecoverNegate"
  | "magicCylinderReflectNegate"
  | "necroGardnaDelayedNegate"
  | "negateAttackPhaseSkip"
  | "scrapIronSetAgainNegate"
  | "superJuniorCalculateDamageSkip"
  | "totemPoleCounterNegate"
  | "windUpKnightBattleTargetNegate";

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

  it("keeps named attack-negation semantic variants explicit", () => {
    expect(countAttackNegationSemanticVariants(realScriptAttackNegationSemanticVariants())).toEqual(attackNegationSemanticVariantCounts);

    const weak = realScriptAttackNegationSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
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
      file: "lua-real-script-necro-gardna-delayed-attack-negate.test.ts",
      kind: "delayedGraveNegate",
      required: [
        'action.type === "activateEffect" && action.uid === necroGardna!.uid',
        'location: "banished"',
        'eventName === "banished"',
        "effect.sourceUid === necroGardna!.uid && effect.code === 1130",
      ],
      outcome: [
        "attackCanceledUids).toEqual([attacker!.uid])",
        'eventName === "attackDisabled"',
        'location: "monsterZone", controller: 0',
      ],
    },
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
      delayedGraveNegate: 0,
      damageReflectNegate: 0,
      lpRecoverNegate: 0,
      monsterTriggerNegate: 0,
      phaseSkipNegate: 0,
      setAgainNegate: 0,
    },
  );
}

function realScriptAttackNegationSemanticVariants(): Array<{
  file: string;
  kind: AttackNegationSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-necro-gardna-delayed-attack-negate.test.ts",
      kind: "necroGardnaDelayedNegate",
      required: [
        'const necroGardnaCode = "4906301"',
        "restores its graveyard self-banish cost and one-shot attack-announcement negate",
        'location: "banished"',
        'eventName === "banished"',
        'eventName === "attackDisabled"',
        "effect.sourceUid === necroGardna!.uid && effect.code === 1130",
      ],
    },
    {
      file: "lua-real-script-draining-shield-battle-window.test.ts",
      kind: "drainingShieldRecoverNegate",
      required: [
        'const drainingShieldCode = "43250041"',
        "restores Draining Shield's attack-declaration target and recovers LP after negating the attack",
        "{ category: 0x100000, targetUids: [], count: 0, player: 1, parameter: 1800 }",
        "players[1].lifePoints).toBe(9800)",
        'eventName: "recoveredLifePoints"',
      ],
    },
    {
      file: "lua-real-script-magic-cylinder-battle-window.test.ts",
      kind: "magicCylinderReflectNegate",
      required: [
        'const magicCylinderCode = "62279055"',
        "restores Magic Cylinder's attack-declaration target and resolves effect damage",
        "{ category: 0x80000, targetUids: [], count: 0, player: 0, parameter: 1800 }",
        "players[0].lifePoints).toBe(6200)",
        'eventName: "damageDealt"',
      ],
    },
    {
      file: "lua-real-script-negate-attack-battle-window.test.ts",
      kind: "negateAttackPhaseSkip",
      required: [
        'const negateAttackCode = "14315573"',
        "restores and resolves Negate Attack from the Project Ignis attack-declaration script",
        "skippedPhases).toEqual([{ player: 0, phase: \"battle\", remaining: 1 }])",
        "action.type === \"declareAttack\" && action.attackerUid === secondAttacker!.uid)).toBe(false)",
        "phase).toBe(\"main2\")",
      ],
    },
    {
      file: "lua-real-script-scrap-iron-scarecrow-battle-window.test.ts",
      kind: "scrapIronSetAgainNegate",
      required: [
        'const scarecrowCode = "98427577"',
        "restores Scrap-Iron Scarecrow and keeps it set after negating the attack",
        "operationInfos ?? []).toEqual([])",
        'location: "spellTrapZone", position: "faceDown", faceUp: false',
        'host.messages).not.toContain("scrap-iron responder resolved")',
      ],
    },
    {
      file: "lua-real-script-super-junior-confrontation-calculate-damage.test.ts",
      kind: "superJuniorCalculateDamageSkip",
      required: [
        'const confrontationCode = "29590905"',
        "restores attack negation into script-selected CalculateDamage and Battle Phase skip",
        'battleWindow?.kind).toBe("attackNegationResponse")',
        "skippedPhases).toEqual([{ player: 1, phase: \"battle\", remaining: 1 }])",
        "battleDamage).toEqual({ 0: 0, 1: 0 })",
        "eventName: \"destroyed\" && event.eventCardUid === defender!.uid",
      ],
    },
    {
      file: "lua-real-script-totem-pole-attack-negate-counter.test.ts",
      kind: "totemPoleCounterNegate",
      required: [
        'const totemPoleCode = "47873397"',
        "restores Totem Pole's attack trigger cost, negates the attack, and adds a counter",
        "counters: { [0x20f]: 1 }",
        'eventName: "counterAdded"',
        "eventReasonEffectId: 4",
      ],
    },
    {
      file: "lua-real-script-wind-up-knight-battle-target-negate.test.ts",
      kind: "windUpKnightBattleTargetNegate",
      required: [
        'const knightCode = "80538728"',
        "restores Wind-Up Knight's battle-target trigger and negates the attack",
        'triggerEvent": "battleTargeted"',
        'triggerBucket": "opponentOptional"',
        'eventName: "battleTargeted"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: AttackNegationSemanticVariant;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function countAttackNegationSemanticVariants(
  fixtures: Array<{ kind: AttackNegationSemanticVariant }>,
): Record<AttackNegationSemanticVariant, number> {
  return fixtures.reduce<Record<AttackNegationSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      drainingShieldRecoverNegate: 0,
      magicCylinderReflectNegate: 0,
      necroGardnaDelayedNegate: 0,
      negateAttackPhaseSkip: 0,
      scrapIronSetAgainNegate: 0,
      superJuniorCalculateDamageSkip: 0,
      totemPoleCounterNegate: 0,
      windUpKnightBattleTargetNegate: 0,
    },
  );
}
