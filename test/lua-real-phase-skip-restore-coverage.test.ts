import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const phaseSkipFixtureCount = 13;
const phaseSkipKindCounts = {
  battlePhaseSkip: 4,
  drawPhaseSkip: 2,
  endTurnLock: 1,
  main1Skip: 3,
  main2Skip: 2,
  multiPhaseEndTurn: 1,
} satisfies Record<PhaseSkipKind, number>;

type PhaseSkipKind = "battlePhaseSkip" | "drawPhaseSkip" | "endTurnLock" | "main1Skip" | "main2Skip" | "multiPhaseEndTurn";

describe("Lua real phase-skip restore coverage", () => {
  it("requires representative phase-skip fixtures to assert clean Lua restore", () => {
    const fixtures = realScriptPhaseSkipFixtures();
    expect(fixtures).toHaveLength(phaseSkipFixtureCount);

    const missing = fixtures
      .filter((fixture) => {
        const text = coverageText(fs.readFileSync(path.join(root, fixture.file), "utf8"));
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
        const text = coverageText(fs.readFileSync(path.join(root, fixture.file), "utf8"));
        return !fixture.requiredSnippets.every((snippet) => hasCoverageSnippet(text, snippet));
      })
      .map((fixture) => fixture.file);

    expect(weak).toEqual([]);
  });

  it("keeps phase-skip fixture kinds explicit", () => {
    expect(countPhaseSkipKinds(realScriptPhaseSkipFixtures())).toEqual(phaseSkipKindCounts);
  });
});

function realScriptPhaseSkipFixtures(): Array<{
  file: string;
  kind: PhaseSkipKind;
  requiredSnippets: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-yata-garasu-skip-draw.test.ts",
      kind: "drawPhaseSkip",
      requiredSnippets: [
        'skippedPhases).toEqual([{ player: 1, phase: "draw", remaining: 1 }])',
        'phase: "main1", waitingFor: 1, skippedPhases: []',
        'location: "deck", controller: 1',
        'eventName: "preDraw", eventPlayer: 1',
      ],
    },
    {
      file: "test/lua-real-script-offerings-skip-draw.test.ts",
      kind: "drawPhaseSkip",
      requiredSnippets: [
        'skippedPhases).toEqual([{ player: 0, phase: "draw", remaining: 1 }])',
        "restoredSkip.restoreComplete",
        "getLuaRestoreLegalActionGroups(restoredSkip, 0)",
        'eventName: "destroyed"',
      ],
    },
    {
      file: "test/lua-real-script-timeater-skip-main1.test.ts",
      kind: "main1Skip",
      requiredSnippets: [
        "code: 182",
        'phase: "main1", waitingFor: 1',
        'type: "changePhase", phase: "battle"',
        'type: "normalSummon"',
      ],
    },
    {
      file: "test/lua-real-script-burning-bamboo-sword-skip-main1.test.ts",
      kind: "main1Skip",
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
      kind: "main1Skip",
      requiredSnippets: [
        'phase: "main1", waitingFor: 1',
        "getLuaRestoreLegalActions(restoredOpponentMain, 1)",
        'type: "changePhase", phase: "battle"',
        'type: "normalSummon", uid: opponentMonster.uid',
      ],
    },
    {
      file: "test/lua-real-script-great-long-nose-skip-battle.test.ts",
      kind: "battlePhaseSkip",
      requiredSnippets: [
        'phase: "main1", waitingFor: 1',
        "getLuaRestoreLegalActionGroups(restoredOpponentMain, 1)",
        'type: "changePhase", phase: "main2"',
        'type: "changePhase", phase: "battle"',
      ],
    },
    {
      file: "test/lua-real-script-super-junior-confrontation-calculate-damage.test.ts",
      kind: "battlePhaseSkip",
      requiredSnippets: [
        'battleWindow?.kind).toBe("attackNegationResponse")',
        'skippedPhases).toEqual([{ player: 1, phase: "battle", remaining: 1 }])',
        'eventName: "attackDisabled"',
        'eventName: "destroyed"',
      ],
    },
    {
      file: "test/lua-real-script-grandsoil-leave-skip-battle.test.ts",
      kind: "battlePhaseSkip",
      requiredSnippets: [
        'phase: "main1"',
        'type: "changePhase", phase: "main2"',
        'type: "changePhase", phase: "battle"',
      ],
    },
    {
      file: "test/lua-real-script-photon-jumper-skip-battle.test.ts",
      kind: "battlePhaseSkip",
      requiredSnippets: [
        'phase = "main2"',
        'phase: "main1", waitingFor: 0',
        'type: "changePhase", phase: "main2"',
        'type: "changePhase", phase: "battle"',
      ],
    },
    {
      file: "test/lua-real-script-master-peace-skip-main2.test.ts",
      kind: "main2Skip",
      requiredSnippets: [
        'phase: "battle", waitingFor: 1',
        'type: "changePhase", phase: "end"',
        'type: "changePhase", phase: "main2"',
      ],
    },
    {
      file: "test/lua-real-script-terminal-world-skip-main2.test.ts",
      kind: "main2Skip",
      requiredSnippets: [
        'phase: "battle", waitingFor: 0',
        "getLuaRestoreLegalActions(restoredBattle, 0)",
        'type: "changePhase", phase: "main2"',
      ],
    },
    {
      file: "test/lua-real-script-mischief-time-goddess-end-lock.test.ts",
      kind: "endTurnLock",
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
      kind: "multiPhaseEndTurn",
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
  ] satisfies Array<{
    file: string;
    kind: PhaseSkipKind;
    requiredSnippets: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countPhaseSkipKinds(fixtures: Array<{ kind: PhaseSkipKind }>): Record<PhaseSkipKind, number> {
  return fixtures.reduce<Record<PhaseSkipKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      battlePhaseSkip: 0,
      drawPhaseSkip: 0,
      endTurnLock: 0,
      main1Skip: 0,
      main2Skip: 0,
      multiPhaseEndTurn: 0,
    },
  );
}
