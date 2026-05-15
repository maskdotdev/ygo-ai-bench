import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const damagePreventionFixtureCount = 10;

describe("Lua real damage-prevention restore coverage", () => {
  it("requires representative real-script damage prevention fixtures to assert restore and response replay", () => {
    const files = realScriptDamagePreventionFixtureFiles();
    expect(files).toHaveLength(damagePreventionFixtureCount);

    const missing = files
      .filter(({ file }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
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
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("lifePoints")
          || !text.includes("eventHistory")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function realScriptDamagePreventionFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-hanewata-effect-damage-zero.test.ts",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(7500)",
        'eventName: "damageDealt", eventPlayer: 1, eventValue: 500',
        'eventName: "battleDamageDealt", eventPlayer: 0, eventValue: 1800',
      ],
    },
    {
      file: "lua-real-script-cyber-kirin-effect-damage-zero.test.ts",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(7500)",
        'eventName: "damageDealt", eventPlayer: 1, eventValue: 500',
      ],
    },
    {
      file: "lua-real-script-dragon-revival-rhapsody-damage-zero.test.ts",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(7000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(8000)",
        'eventName: "damageDealt", eventPlayer: 0, eventValue: 1000',
        'eventName: "damageDealt", eventPlayer: 1',
      ],
    },
    {
      file: "lua-real-script-shiranui-samsara-damage-zero.test.ts",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(7500)",
        'eventName: "damageDealt", eventPlayer: 1, eventValue: 500',
      ],
    },
    {
      file: "lua-real-script-cyberse-magician-half-damage.test.ts",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(7500)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(7500)",
        'eventName: "damageDealt", eventPlayer: 0, eventValue: 500',
        'eventName: "damageDealt", eventPlayer: 1, eventValue: 500',
      ],
    },
    {
      file: "lua-real-script-supreme-king-gate-zero-damage-zero.test.ts",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(7500)",
        'eventName: "damageDealt", eventPlayer: 1, eventValue: 500',
      ],
    },
    {
      file: "lua-real-script-cocoon-veil-damage-zero.test.ts",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(7500)",
        'eventName: "damageDealt", eventPlayer: 1, eventValue: 500',
      ],
    },
    {
      file: "lua-real-script-trapeze-magician-atk-damage-zero.test.ts",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(7500)",
        'eventName: "damageDealt", eventPlayer: 1, eventValue: 500',
      ],
    },
    {
      file: "lua-real-script-one-day-peace-damage-zero.test.ts",
      required: [
        "expect(restoredFire.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restoredFire.session.state.players[1].lifePoints).toBe(8000)",
        'eventName: "damageDealt"',
        'eventName: "battleDamageDealt", eventPlayer: 0',
        "expect(restoredFire.session.state.battleDamage).toEqual({ 0: 0, 1: 0 })",
      ],
    },
    {
      file: "lua-real-script-kuriboh-pre-damage-prevent.test.ts",
      required: [
        "expect(restored.session.state.players[0].lifePoints).toBe(8000)",
        "expect(restored.session.state.players[1].lifePoints).toBe(8000)",
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 })",
        'eventName: "battleDamageDealt", eventPlayer: 0',
      ],
    },
  ].map(({ file, required }) => ({ file: path.join("test", file), required }));
}
