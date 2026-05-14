import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Lua real prompt helper restore coverage", () => {
  it("keeps the representative prompt helper fixture inventory broad", () => {
    expect(representativePromptHelperFixtures()).toHaveLength(13);
  });

  it("requires representative prompt helper fixtures to assert clean Lua restore", () => {
    const missing = representativePromptHelperFixtures()
      .filter(({ file }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires representative prompt helper fixtures to prove restored prompt semantics", () => {
    const weak = representativePromptHelperFixtures()
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(weak).toEqual([]);
  });
});

function representativePromptHelperFixtures(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-gunkan-suship-catch-select-codes.test.ts",
      required: [
        "restores the opponent code-selection prompt into the chosen Suship search",
        'api: "SelectCardsFromCodes"',
        "options: [Number(sushipIkuraCode), Number(sushipUniCode), Number(sushipShirauoCode)]",
        "returned: Number(sushipIkuraCode)",
        'location: "hand"',
        'expect(restored.host.messages).not.toContain("gunkan suship responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-gishki-psychelone-announce-traits.test.ts",
      required: [
        "restores announced race and attribute labels into the opponent hand shuffle",
        'api: "AnnounceRace"',
        'api: "AnnounceAttribute"',
        "effectLabel: raceWarrior",
        "effectLabels: [raceWarrior, attributeEarth]",
        'card?.location === "deck"',
        'expect(restored.host.messages).not.toContain("gishki psychelone responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-gagaga-magician-announce-level.test.ts",
      required: [
        "restores announced level label into the temporary level change",
        'api: "AnnounceLevel"',
        "options: [1, 2, 3, 5, 6, 7, 8]",
        "effectLabel: 1",
        "currentLevel(restoredGagaga, restored.session.state)).toBe(1)",
        'expect(restored.host.messages).not.toContain("gagaga magician responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-inferno-ashened-field-zone-option.test.ts",
      required: [
        "restores a leading-false SelectOption branch that places Obsidim in the opponent Field Zone",
        'expect.objectContaining({ api: "SelectOption", player: 0, options: [1, 2], descriptions: [expect.any(Number), expect.any(Number)], returned: 1 })',
        'location: "spellTrapZone"',
        'controller: 1',
        'expect(restored.host.messages).not.toContain("inferno ashened responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-primite-lordly-lode.test.ts",
      required: [
        "restores dynamic AnnounceCard into the declared Normal Monster summon and effect lock",
        "targetParam: Number(darkMagicianCode)",
        'position: "faceUpDefense"',
        "cannot-activate:special-summoned-monster-on-field",
      ],
    },
    {
      file: "test/lua-real-script-laval-blaster-announce-number.test.ts",
      required: [
        "restores dynamic AnnounceNumber deck-discard cost into its ATK boost",
        "currentAttack(restoredBlaster, restoredChainWindow.session.state)).toBe((lavalBlaster!.data.attack ?? 0) + 1000)",
        'expect(restoredChainWindow.host.messages).not.toContain("laval blaster responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-lightning-storm-select-effect.test.ts",
      required: [
        "restores Lightning Storm's selected attack-position monster destroy mode",
        "restores Lightning Storm's selected Spell/Trap destroy mode",
        "effectLabel: 1",
        "effectLabel: 2",
        'expect(host.messages).not.toContain("lightning storm responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-magikey-duo-defense-ritual.test.ts",
      required: [
        "restores a target-returning Ritual.Operation branch with sumpos face-up Defense",
        'expect.objectContaining({ api: "SelectOption", player: 0, options: [1, 2], descriptions: [expect.any(Number), expect.any(Number)], returned: 1 })',
        'position: "faceUpDefense"',
        'summonType: "ritual"',
        'expect(restored.host.messages).not.toContain("magikey duo responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-magikey-maftea-deck-ritual.test.ts",
      required: [
        "restores non-sentinel SelectOption into Ritual extra material extraop",
        'expect.objectContaining({ api: "SelectOption", player: 0, options: [0], descriptions: [expect.any(Number)], returned: 0 })',
        "summonMaterialUids).toEqual([handMaterial!.uid, faceupNormal!.uid, deckNormalMaterial!.uid])",
        "reason: duelReason.effect | duelReason.material | duelReason.ritual",
        'expect(restored.host.messages).not.toContain("magikey maftea responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-mirror-mage-announce-number-range.test.ts",
      required: [
        "restores announced token count into token summons and level update",
        'api: "AnnounceNumberRange"',
        "options: [1, 2, 3]",
        "currentLevel(restoredMirrorMage, restored.session.state)).toBe((mirrorMage.data.level ?? 0) + 1)",
        "card.code === iceBarrierTokenCode && card.location === \"monsterZone\"",
        'expect(restored.host.messages).not.toContain("mirror mage responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-springans-ship-select-field-zone.test.ts",
      required: [
        "restores Exblowrer's selected opponent field zone chain label",
        'api: "SelectFieldZone"',
        "returned: 1 << 16",
        'location: "monsterZone"',
        "overlayUids: [material.uid]",
        'expect(restored.host.messages).not.toContain("springans ship responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-sprind-select-disable-field.test.ts",
      required: [
        "restores the selected disabled-field zone into the column movement operation",
        'api: "SelectDisableField"',
        "options: [1, 8, 16]",
        "sequence: 0",
        'expect(restored.host.messages).not.toContain("sprind responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-vernusylph-attribute-activation-lock.test.ts",
      required: [
        "restores the shared helper's non-EARTH monster effect activation lock",
        'expect.objectContaining({ api: "SelectYesNo", player: 0, returned: true })',
        "cannot-activate:monster-attribute-except:1",
        "expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === \"activateEffect\" && action.uid === fireResponder.uid)).toBe(false)",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
