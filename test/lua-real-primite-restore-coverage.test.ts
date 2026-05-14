import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Lua real Primite restore coverage", () => {
  it("requires Primite fixtures to assert clean restore and restored outcomes", () => {
    const missing = primiteFixtureFiles()
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function primiteFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-primite-drillbeam.test.ts",
      required: [
        "restoredActivation.missingRegistryKeys).toEqual([])",
        "restoredSet.missingRegistryKeys).toEqual([])",
        "category: 0x4000",
        "category: 0x4",
        'location: "banished", faceUp: true',
        'location: "spellTrapZone"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-primite-imperial-dragon.test.ts",
      required: [
        "getLuaRestoreLegalActionGroups",
        'type: "tributeSummon"',
        'eventName: "normalSummoned"',
        'location: "banished"',
        'summonType: "tribute"',
      ],
    },
    {
      file: "test/lua-real-script-primite-howl-battle-damage.test.ts",
      required: [
        "target:setcode-or-code-type:432:46986414:16",
        'action.type === "declareAttack"',
        "battleDamage[0]).toBe(0)",
        "lifePoints).toBe(8000)",
      ],
    },
    {
      file: "test/lua-real-script-primite-dragon-ether-beryl.test.ts",
      required: [
        "restored.missingRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        "operationInfos: [{ category: 0x20",
        'location: "spellTrapZone"',
        'location: "graveyard"',
        "getLuaRestoreLegalActionGroups",
      ],
    },
    {
      file: "test/lua-real-script-primite-fusion-extra-check.test.ts",
      required: [
        "restored.missingRegistryKeys).toEqual([])",
        'summonType: "fusion"',
        "summonMaterialUids: [normalMaterial!.uid, effectMaterial!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        "host.messages).not.toContain",
        "getLuaRestoreLegalActionGroups",
      ],
    },
    {
      file: "test/lua-real-script-primite-lordly-lode.test.ts",
      required: [
        "getLuaRestoreLegalActionGroups",
        "cannot-activate:special-summoned-monster-on-field",
        'action.type === "activateEffect"',
        "toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-primite-roar.test.ts",
      required: [
        "restoredActivation.missingRegistryKeys).toEqual([])",
        "restoredProtection.missingRegistryKeys).toEqual([])",
        "restoredTrigger.missingRegistryKeys).toEqual([])",
        "target:setcode-or-code-type:432:46986414:16",
        'location: "banished"',
        "getLuaRestoreLegalActionGroups",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
