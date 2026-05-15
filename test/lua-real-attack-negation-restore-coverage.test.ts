import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const attackNegationFixtureCount = 4;

describe("Lua real attack negation restore coverage", () => {
  it("requires representative attack-negation fixtures to assert clean Lua restore and legal-action parity", () => {
    const files = realScriptAttackNegationFixtureFiles();
    expect(files).toHaveLength(attackNegationFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("applyLuaRestoreResponse")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires attack-negation fixtures to prove restored attack cleanup and script-specific outcomes", () => {
    const files = realScriptAttackNegationFixtureFiles();
    expect(files).toHaveLength(attackNegationFixtureCount);

    const missing = files
      .filter(({ file, outcome }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("pendingBattle).toBeUndefined()")
          || !text.includes("currentAttack).toBeUndefined()")
          || !text.includes("attackCanceledUids).toEqual")
          || outcome.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function realScriptAttackNegationFixtureFiles(): Array<{ file: string; required: string[]; outcome: string[] }> {
  return [
    {
      file: "lua-real-script-wind-up-knight-battle-target-negate.test.ts",
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
      file: "lua-real-script-scrap-iron-scarecrow-battle-window.test.ts",
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
      file: "lua-real-script-totem-pole-attack-negate-counter.test.ts",
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
  ]
    .map(({ file, required, outcome }) => ({ file: path.join("test", file), required, outcome }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
