import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const phaseSkipFixtureCount = 12;

describe("Lua real phase-skip restore coverage", () => {
  it("requires representative phase-skip fixtures to assert clean Lua restore", () => {
    const fixtures = realScriptPhaseSkipFixtures();
    expect(fixtures).toHaveLength(phaseSkipFixtureCount);

    const missing = fixtures
      .filter((fixture) => {
        const text = fs.readFileSync(path.join(root, fixture.file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      })
      .map((fixture) => fixture.file);

    expect(missing).toEqual([]);
  });

  it("requires representative phase-skip fixtures to prove restored skipped phase legal-action effects", () => {
    const fixtures = realScriptPhaseSkipFixtures();
    expect(fixtures).toHaveLength(phaseSkipFixtureCount);

    const weak = fixtures
      .filter((fixture) => {
        const text = fs.readFileSync(path.join(root, fixture.file), "utf8");
        return !fixture.requiredSnippets.every((snippet) => text.includes(snippet));
      })
      .map((fixture) => fixture.file);

    expect(weak).toEqual([]);
  });
});

function realScriptPhaseSkipFixtures(): Array<{ file: string; requiredSnippets: string[] }> {
  return [
    {
      file: "test/lua-real-script-yata-garasu-skip-draw.test.ts",
      requiredSnippets: [
        'skippedPhases).toEqual([{ player: 1, phase: "draw", remaining: 1 }])',
        'phase: "main1", waitingFor: 1, skippedPhases: []',
        'location: "deck", controller: 1',
        'eventName: "preDraw", eventPlayer: 1',
      ],
    },
    {
      file: "test/lua-real-script-timeater-skip-main1.test.ts",
      requiredSnippets: [
        "code: 182",
        'phase: "main1", waitingFor: 1',
        'type: "changePhase", phase: "battle"',
        'type: "normalSummon"',
      ],
    },
    {
      file: "test/lua-real-script-burning-bamboo-sword-skip-main1.test.ts",
      requiredSnippets: [
        'eventName: "chaining", eventCode: 1027',
        "code: 182",
        'phase: "main1", waitingFor: 1',
        'type: "changePhase", phase: "battle"',
        'type: "normalSummon"',
      ],
    },
    {
      file: "test/lua-real-script-amorphactor-pain-skip-main1.test.ts",
      requiredSnippets: [
        'phase: "main1", waitingFor: 1',
        "getLuaRestoreLegalActions(restoredOpponentMain, 1)",
        'type: "changePhase", phase: "battle"',
        'type: "normalSummon", uid: opponentMonster.uid',
      ],
    },
    {
      file: "test/lua-real-script-great-long-nose-skip-battle.test.ts",
      requiredSnippets: [
        'phase: "main1", waitingFor: 1',
        "getLuaRestoreLegalActionGroups(restoredOpponentMain, 1)",
        'type: "changePhase", phase: "main2"',
        'type: "changePhase", phase: "battle"',
      ],
    },
    {
      file: "test/lua-real-script-super-junior-confrontation-calculate-damage.test.ts",
      requiredSnippets: [
        'battleWindow?.kind).toBe("attackNegationResponse")',
        'skippedPhases).toEqual([{ player: 1, phase: "battle", remaining: 1 }])',
        'eventName: "attackDisabled"',
        'eventName: "destroyed"',
      ],
    },
    {
      file: "test/lua-real-script-grandsoil-leave-skip-battle.test.ts",
      requiredSnippets: [
        'phase: "main1"',
        'type: "changePhase", phase: "main2"',
        'type: "changePhase", phase: "battle"',
      ],
    },
    {
      file: "test/lua-real-script-photon-jumper-skip-battle.test.ts",
      requiredSnippets: [
        'phase = "main2"',
        'phase: "main1", waitingFor: 0',
        'type: "changePhase", phase: "main2"',
        'type: "changePhase", phase: "battle"',
      ],
    },
    {
      file: "test/lua-real-script-master-peace-skip-main2.test.ts",
      requiredSnippets: [
        'phase: "battle", waitingFor: 1',
        'type: "changePhase", phase: "end"',
        'type: "changePhase", phase: "main2"',
      ],
    },
    {
      file: "test/lua-real-script-terminal-world-skip-main2.test.ts",
      requiredSnippets: [
        'phase: "battle", waitingFor: 0',
        "getLuaRestoreLegalActions(restoredBattle, 0)",
        'type: "changePhase", phase: "main2"',
      ],
    },
    {
      file: "test/lua-real-script-mischief-time-goddess-end-lock.test.ts",
      requiredSnippets: [
        "code: 187",
        "effect.code === 188",
        'session.state.phase = "main2"',
        'type: "changePhase", phase: "end"',
        'type: "endTurn", player: 1',
      ],
    },
    {
      file: "test/lua-real-script-neko-mane-king-end-turn.test.ts",
      requiredSnippets: [
        '{ player: 1, phase: "draw", remaining: 1 }',
        '{ player: 1, phase: "standby", remaining: 1 }',
        '{ player: 1, phase: "main1", remaining: 1 }',
        '{ player: 1, phase: "battle", remaining: 1 }',
        '{ player: 1, phase: "main2", remaining: 1 }',
        'type: "changePhase", phase: "battle"',
        'type: "changePhase", phase: "main2"',
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
