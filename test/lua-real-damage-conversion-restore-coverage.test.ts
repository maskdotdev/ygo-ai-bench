import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const damageConversionFixtureCount = 5;

describe("Lua real damage conversion restore coverage", () => {
  it("requires effect damage conversion fixtures to assert clean Lua registry restore and final LP/event outcomes", () => {
    const files = damageConversionFixtureFiles();
    expect(files).toHaveLength(damageConversionFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("eventHistory")
          || !text.includes("lifePoints")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires UI-facing legal-action parity where restored conversion chains expose actions", () => {
    const files = damageConversionFixtureFiles();
    expect(files).toHaveLength(damageConversionFixtureCount);

    const missing = files
      .filter(({ file }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function damageConversionFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-bad-reaction-reverse-recover.test.ts",
      required: [
        "Bad Reaction reverse recover",
        "code: 81",
        "cardsDrawn",
        "players[1].lifePoints).toBe(7000)",
        "damageDealt",
      ],
    },
    {
      file: "lua-real-script-ddd-rebel-king-leonidas-reverse-damage.test.ts",
      required: [
        "D/D/D Rebel King Leonidas reverse damage",
        "code: 80",
        "value-predicate:effect-reason",
        "players[0].lifePoints).toBe(8000)",
        "recoveredLifePoints",
      ],
    },
    {
      file: "lua-real-script-des-wombat-no-effect-damage.test.ts",
      required: [
        "Des Wombat no effect damage",
        "code: 335",
        "players[0].lifePoints).toBe(8000)",
        "players[1].lifePoints).toBe(7000)",
        "not.toEqual(expect.arrayContaining([expect.objectContaining({ eventName: \"damageDealt\", eventPlayer: 0 })]))",
      ],
    },
    {
      file: "lua-real-script-prime-material-dragon-reverse-damage.test.ts",
      required: [
        "Prime Material Dragon reverse damage",
        "code: 80",
        "players[0].lifePoints).toBe(8500)",
        "players[1].lifePoints).toBe(9000)",
        "recoveredLifePoints",
      ],
    },
    {
      file: "lua-real-script-totem-pole-change-damage.test.ts",
      required: [
        "Totem Pole change damage",
        "change-damage:effect-double",
        "players[0].lifePoints).toBe(7500)",
        "players[1].lifePoints).toBe(6000)",
        "eventValue: 2000",
      ],
    },
  ]
    .map(({ file, required }) => ({ file: path.join("test", file), required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
