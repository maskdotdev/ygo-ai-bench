import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const damagePreventionFixtureCount = 11;
const damagePreventionKindCounts: Record<DamagePreventionKind, number> = {
  allDamageZero: 1,
  battleDamageZero: 1,
  effectDamageHalf: 1,
  effectDamageZero: 7,
  noBattleDamage: 1,
};

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
});

type DamagePreventionKind = "allDamageZero" | "battleDamageZero" | "effectDamageHalf" | "effectDamageZero" | "noBattleDamage";

function countDamagePreventionKinds(fixtures: Array<{ kind: DamagePreventionKind }>): Record<DamagePreventionKind, number> {
  return fixtures.reduce<Record<DamagePreventionKind, number>>(
    (counts, { kind }) => ({ ...counts, [kind]: counts[kind] + 1 }),
    { allDamageZero: 0, battleDamageZero: 0, effectDamageHalf: 0, effectDamageZero: 0, noBattleDamage: 0 },
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
