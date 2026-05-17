import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const damagePreventionFixtureCount = 12;
const damagePreventionKindCounts: Record<DamagePreventionKind, number> = {
  allDamageZero: 1,
  battleDamageZero: 2,
  effectDamageHalf: 1,
  effectDamageZero: 7,
  noBattleDamage: 1,
};
const damagePreventionSemanticVariantCounts = {
  cocoonVeilReleaseCostDamageLock: 1,
  cyberKirinSelfTributeEffectDamagePrevention: 1,
  cyberseMagicianPersistentDamageHalving: 1,
  dragonRevivalRhapsodyOpponentDamageLock: 1,
  hanewataEffectDamageOnlyPrevention: 1,
  kuribohBeforeDamageBattleDamagePrevent: 1,
  miracleLocusOpponentOnlyBattleDamageSuppression: 1,
  oneDayPeaceAllDamageZero: 1,
  primiteHowlNormalMonsterBattleDamagePrevention: 1,
  shiranuiSamsaraBanishCostDamageLock: 1,
  supremeKingGateZeroPendulumDamageLock: 1,
  trapezeMagicianAtkThresholdDamagePrevention: 1,
} satisfies Record<DamagePreventionSemanticVariant, number>;

describe("Lua real damage-prevention restore coverage", () => {
  it("keeps damage-prevention fixture kinds explicit", () => {
    expect(countDamagePreventionKinds(realScriptDamagePreventionFixtureFiles())).toEqual(damagePreventionKindCounts);
  });

  it("requires representative real-script damage prevention fixtures to assert restore and response replay", () => {
    const files = realScriptDamagePreventionFixtureFiles();
    expect(files).toHaveLength(damagePreventionFixtureCount);

    const missing = files
      .filter(({ file }) => {
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
          || !text.includes('type === "activateEffect"');
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires representative real-script damage prevention fixtures to prove protected and unprotected damage outcomes", () => {
    const files = realScriptDamagePreventionFixtureFiles();
    expect(files).toHaveLength(damagePreventionFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("lifePoints")
          || !text.includes("eventHistory")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps named damage-prevention semantic variants explicit", () => {
    expect(countDamagePreventionSemanticVariants(damagePreventionSemanticVariants())).toEqual(damagePreventionSemanticVariantCounts);

    const weak = damagePreventionSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

type DamagePreventionKind = "allDamageZero" | "battleDamageZero" | "effectDamageHalf" | "effectDamageZero" | "noBattleDamage";
type DamagePreventionSemanticVariant =
  | "cocoonVeilReleaseCostDamageLock"
  | "cyberKirinSelfTributeEffectDamagePrevention"
  | "cyberseMagicianPersistentDamageHalving"
  | "dragonRevivalRhapsodyOpponentDamageLock"
  | "hanewataEffectDamageOnlyPrevention"
  | "kuribohBeforeDamageBattleDamagePrevent"
  | "miracleLocusOpponentOnlyBattleDamageSuppression"
  | "oneDayPeaceAllDamageZero"
  | "primiteHowlNormalMonsterBattleDamagePrevention"
  | "shiranuiSamsaraBanishCostDamageLock"
  | "supremeKingGateZeroPendulumDamageLock"
  | "trapezeMagicianAtkThresholdDamagePrevention";

function countDamagePreventionKinds(fixtures: Array<{ kind: DamagePreventionKind }>): Record<DamagePreventionKind, number> {
  return fixtures.reduce<Record<DamagePreventionKind, number>>(
    (counts, { kind }) => ({ ...counts, [kind]: counts[kind] + 1 }),
    { allDamageZero: 0, battleDamageZero: 0, effectDamageHalf: 0, effectDamageZero: 0, noBattleDamage: 0 },
  );
}

function damagePreventionSemanticVariants(): Array<{
  file: string;
  kind: DamagePreventionSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-cocoon-veil-damage-zero.test.ts",
      kind: "cocoonVeilReleaseCostDamageLock",
      required: [
        'const cocoonVeilCode = "56641453"',
        "restores its release-cost damage lock and selected Special Summon",
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
      ],
    },
    {
      file: "lua-real-script-cyber-kirin-effect-damage-zero.test.ts",
      kind: "cyberKirinSelfTributeEffectDamagePrevention",
      required: [
        'const cyberKirinCode = "76986005"',
        "restores its self-tribute ignition into effect-damage prevention",
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
      ],
    },
    {
      file: "lua-real-script-cyberse-magician-half-damage.test.ts",
      kind: "cyberseMagicianPersistentDamageHalving",
      required: [
        'const cyberseMagicianCode = "24731391"',
        "restores its persistent callback-valued damage halving",
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(7500)",
        "eventPlayer: 0,\n        eventValue: 500",
      ],
    },
    {
      file: "lua-real-script-dragon-revival-rhapsody-damage-zero.test.ts",
      kind: "dragonRevivalRhapsodyOpponentDamageLock",
      required: [
        'const rhapsodyCode = "71867500"',
        "restores its opponent damage lock after Graveyard Dragon summons",
        "event.eventName === \"damageDealt\" && event.eventPlayer === 1)).toEqual([])",
      ],
    },
    {
      file: "lua-real-script-hanewata-effect-damage-zero.test.ts",
      kind: "hanewataEffectDamageOnlyPrevention",
      required: [
        'const hanewataCode = "20450925"',
        "restores its effect-damage-only callback while leaving battle damage unchanged",
        "eventName: \"battleDamageDealt\", eventPlayer: 0, eventValue: 1800",
      ],
    },
    {
      file: "lua-real-script-kuriboh-pre-damage-prevent.test.ts",
      kind: "kuribohBeforeDamageBattleDamagePrevent",
      required: [
        'const kuribohCode = "40640057"',
        "restores its before-damage hand Quick Effect and prevents battle damage after self-discard cost",
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 })",
      ],
    },
    {
      file: "lua-real-script-miracle-locus-temporary-no-battle-damage.test.ts",
      kind: "miracleLocusOpponentOnlyBattleDamageSuppression",
      required: [
        'const miracleLocusCode = "97168905"',
        "restores its temporary ATK, extra monster attack, and opponent-only battle-damage suppression",
        "expect(restoredEffects.session.state.battleDamage).toEqual({ 0: 800, 1: 0 })",
      ],
    },
    {
      file: "lua-real-script-one-day-peace-damage-zero.test.ts",
      kind: "oneDayPeaceAllDamageZero",
      required: [
        'const peaceCode = "33782437"',
        "restores its two-turn player damage prevention and applies it to effect and battle damage",
        "expect(restoredFire.session.state.battleDamage).toEqual({ 0: 0, 1: 0 })",
      ],
    },
    {
      file: "lua-real-script-primite-howl-battle-damage.test.ts",
      kind: "primiteHowlNormalMonsterBattleDamagePrevention",
      required: [
        'const primiteHowlCode = "41488249"',
        "restores the announced Normal Monster battle damage prevention",
        "event.eventName === \"battleDamageDealt\" && event.eventPlayer === 0)).toEqual([])",
      ],
    },
    {
      file: "lua-real-script-shiranui-samsara-damage-zero.test.ts",
      kind: "shiranuiSamsaraBanishCostDamageLock",
      required: [
        'const samsaraCode = "78765160"',
        "restores its face-up Trap quick effect damage lock after banish cost",
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
      ],
    },
    {
      file: "lua-real-script-supreme-king-gate-zero-damage-zero.test.ts",
      kind: "supremeKingGateZeroPendulumDamageLock",
      required: [
        'const gateZeroCode = "96227613"',
        "restores its Pendulum Zone damage-zero callback while Z-ARC is face-up",
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
      ],
    },
    {
      file: "lua-real-script-trapeze-magician-atk-damage-zero.test.ts",
      kind: "trapezeMagicianAtkThresholdDamagePrevention",
      required: [
        'const trapezeCode = "17016362"',
        "restores its ATK-threshold effect-damage prevention",
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DamagePreventionSemanticVariant;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function countDamagePreventionSemanticVariants(
  fixtures: Array<{ kind: DamagePreventionSemanticVariant }>,
): Record<DamagePreventionSemanticVariant, number> {
  return fixtures.reduce<Record<DamagePreventionSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      cocoonVeilReleaseCostDamageLock: 0,
      cyberKirinSelfTributeEffectDamagePrevention: 0,
      cyberseMagicianPersistentDamageHalving: 0,
      dragonRevivalRhapsodyOpponentDamageLock: 0,
      hanewataEffectDamageOnlyPrevention: 0,
      kuribohBeforeDamageBattleDamagePrevent: 0,
      miracleLocusOpponentOnlyBattleDamageSuppression: 0,
      oneDayPeaceAllDamageZero: 0,
      primiteHowlNormalMonsterBattleDamagePrevention: 0,
      shiranuiSamsaraBanishCostDamageLock: 0,
      supremeKingGateZeroPendulumDamageLock: 0,
      trapezeMagicianAtkThresholdDamagePrevention: 0,
    },
  );
}

function realScriptDamagePreventionFixtureFiles(): Array<{ file: string; kind: DamagePreventionKind; required: string[] }> {
  return ([
    {
      file: "lua-real-script-hanewata-effect-damage-zero.test.ts",
      kind: "effectDamageZero",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(7500)",
        'eventName: "damageDealt"',
        "eventPlayer: 1,\n        eventValue: 500",
        'eventName: "battleDamageDealt", eventPlayer: 0, eventValue: 1800',
      ],
    },
    {
      file: "lua-real-script-cyber-kirin-effect-damage-zero.test.ts",
      kind: "effectDamageZero",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(7500)",
        'eventName: "damageDealt"',
        "eventPlayer: 1,\n        eventValue: 500",
      ],
    },
    {
      file: "lua-real-script-dragon-revival-rhapsody-damage-zero.test.ts",
      kind: "effectDamageZero",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(7000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(8000)",
        'eventName: "damageDealt"',
        "eventPlayer: 0,\n        eventValue: 1000",
        'event.eventName === "damageDealt" && event.eventPlayer === 1)).toEqual([])',
      ],
    },
    {
      file: "lua-real-script-shiranui-samsara-damage-zero.test.ts",
      kind: "effectDamageZero",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(7500)",
        'eventName: "damageDealt"',
        "eventPlayer: 1,\n        eventValue: 500",
      ],
    },
    {
      file: "lua-real-script-cyberse-magician-half-damage.test.ts",
      kind: "effectDamageHalf",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(7500)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(7500)",
        'eventName: "damageDealt"',
        "eventPlayer: 0,\n        eventValue: 500",
        "eventPlayer: 1,\n        eventValue: 500",
      ],
    },
    {
      file: "lua-real-script-supreme-king-gate-zero-damage-zero.test.ts",
      kind: "effectDamageZero",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(7500)",
        'eventName: "damageDealt"',
        "eventPlayer: 1,\n        eventValue: 500",
      ],
    },
    {
      file: "lua-real-script-cocoon-veil-damage-zero.test.ts",
      kind: "effectDamageZero",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(7500)",
        'eventName: "damageDealt"',
        "eventPlayer: 1,\n        eventValue: 500",
      ],
    },
    {
      file: "lua-real-script-trapeze-magician-atk-damage-zero.test.ts",
      kind: "effectDamageZero",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(7500)",
        'eventName: "damageDealt"',
        "eventPlayer: 1,\n        eventValue: 500",
      ],
    },
    {
      file: "lua-real-script-one-day-peace-damage-zero.test.ts",
      kind: "allDamageZero",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(8000)",
        'event.eventName === "damageDealt")).toEqual([])',
        'event.eventName === "battleDamageDealt" && event.eventPlayer === 0)).toEqual([])',
        "expect(restoredFire.session.state.battleDamage).toEqual({ 0: 0, 1: 0 })",
      ],
    },
    {
      file: "lua-real-script-kuriboh-pre-damage-prevent.test.ts",
      kind: "battleDamageZero",
      required: [
        "expect(restored.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restored.session.state.players[1].lifePoints).toBe(8000)",
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 })",
        'eventName: "battleDamageDealt", eventPlayer: 0',
      ],
    },
    {
      file: "lua-real-script-primite-howl-battle-damage.test.ts",
      kind: "battleDamageZero",
      required: [
        "expect(restored.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restored.session.state.battleDamage[0]).toBe(0)",
        "code: 201",
        'event.eventName === "battleDamageDealt" && event.eventPlayer === 0)).toEqual([])',
        'location: "graveyard"',
      ],
    },
    {
      file: "lua-real-script-miracle-locus-temporary-no-battle-damage.test.ts",
      kind: "noBattleDamage",
      required: [
        "expect(restoredEffects.session.state.players[0].lifePoints).toBe(7200)",
        "expect(restoredEffects.session.state.players[1].lifePoints).toBe(8000)",
        "expect(restoredEffects.session.state.battleDamage).toEqual({ 0: 800, 1: 0 })",
        "code: 200",
        "code: 346",
        'eventName: "battleDamageDealt"',
        "eventPlayer: 0, eventValue: 800",
        'event.eventName === "battleDamageDealt" && event.eventPlayer === 1)).toEqual([])',
      ],
    },
  ] satisfies Array<{ file: string; kind: DamagePreventionKind; required: string[] }>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}
