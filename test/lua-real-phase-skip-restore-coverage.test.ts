import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const phaseSkipFixtureCount = 14;
const phaseSkipKindCounts = {
  battlePhaseSkip: 4,
  drawPhaseSkip: 3,
  endTurnLock: 1,
  main1Skip: 3,
  main2Skip: 2,
  multiPhaseEndTurn: 1,
} satisfies Record<PhaseSkipKind, number>;
const phaseSkipSemanticVariantCounts = {
  amorphactorPainRitualMain1Skip: 1,
  burningBambooSwordChainingMain1Skip: 1,
  grandsoilLeaveSelfTurnBattleSkip: 1,
  greatLongNoseBattleDamageBattleSkip: 1,
  masterPeaceBattleDestroyMain2Skip: 1,
  mischiefTimeGoddessEndTurnOnlyWindow: 1,
  nekoManeKingMultiPhaseEndTurnLock: 1,
  offeringsDestroyDrawSkip: 1,
  photonJumperHandTriggerBattleSkip: 1,
  recklessGreedTwoDrawSkips: 1,
  superJuniorAttackNegationBattleSkip: 1,
  terminalWorldPersistentMain2Skip: 1,
  timeaterBattleDestroyMain1Skip: 1,
  yataGarasuBattleDamageDrawSkip: 1,
} satisfies Record<PhaseSkipSemanticVariant, number>;

type PhaseSkipKind = "battlePhaseSkip" | "drawPhaseSkip" | "endTurnLock" | "main1Skip" | "main2Skip" | "multiPhaseEndTurn";
type PhaseSkipSemanticVariant =
  | "amorphactorPainRitualMain1Skip"
  | "burningBambooSwordChainingMain1Skip"
  | "grandsoilLeaveSelfTurnBattleSkip"
  | "greatLongNoseBattleDamageBattleSkip"
  | "masterPeaceBattleDestroyMain2Skip"
  | "mischiefTimeGoddessEndTurnOnlyWindow"
  | "nekoManeKingMultiPhaseEndTurnLock"
  | "offeringsDestroyDrawSkip"
  | "photonJumperHandTriggerBattleSkip"
  | "recklessGreedTwoDrawSkips"
  | "superJuniorAttackNegationBattleSkip"
  | "terminalWorldPersistentMain2Skip"
  | "timeaterBattleDestroyMain1Skip"
  | "yataGarasuBattleDamageDrawSkip";

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

  it("keeps named phase-skip semantic variants explicit", () => {
    expect(countPhaseSkipSemanticVariants(phaseSkipSemanticVariants())).toEqual(phaseSkipSemanticVariantCounts);

    const weak = phaseSkipSemanticVariants()
      .filter(({ file, requiredSnippets }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return requiredSnippets.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
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
      file: "test/lua-real-script-reckless-greed-draw-skip.test.ts",
      kind: "drawPhaseSkip",
      requiredSnippets: [
        'skippedPhases).toEqual([{ player: 0, phase: "draw", remaining: 2 }])',
        "restoredSkip.restoreComplete",
        "getLuaRestoreLegalActionGroups(restoredSkip, 0)",
        'eventName: "cardsDrawn"',
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

function phaseSkipSemanticVariants(): Array<{
  file: string;
  kind: PhaseSkipSemanticVariant;
  requiredSnippets: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-amorphactor-pain-skip-main1.test.ts",
      kind: "amorphactorPainRitualMain1Skip",
      requiredSnippets: [
        'const amorphactorCode = "98287529"',
        "restores its ritual-summon opponent Main Phase 1 skip as legal-action lockout",
        'type: "changePhase", phase: "battle"',
      ],
    },
    {
      file: "test/lua-real-script-burning-bamboo-sword-skip-main1.test.ts",
      kind: "burningBambooSwordChainingMain1Skip",
      requiredSnippets: [
        'const burningCode = "55870497"',
        "restores its official EVENT_CHAINING trigger into an opponent Main Phase 1 skip",
        'eventName: "chaining", eventCode: 1027',
      ],
    },
    {
      file: "test/lua-real-script-grandsoil-leave-skip-battle.test.ts",
      kind: "grandsoilLeaveSelfTurnBattleSkip",
      requiredSnippets: [
        'const grandsoilCode = "61468779"',
        "restores Elemental Lord self-turn skip conditions after leaving the field",
        'type: "changePhase", phase: "main2"',
      ],
    },
    {
      file: "test/lua-real-script-great-long-nose-skip-battle.test.ts",
      kind: "greatLongNoseBattleDamageBattleSkip",
      requiredSnippets: [
        'const noseCode = "2356994"',
        "restores its battle-damage trigger into an opponent Battle Phase skip",
        'type: "changePhase", phase: "main2"',
      ],
    },
    {
      file: "test/lua-real-script-master-peace-skip-main2.test.ts",
      kind: "masterPeaceBattleDestroyMain2Skip",
      requiredSnippets: [
        'const masterPeaceCode = "12800564"',
        "restores its official opponent Battle Phase destruction into a Main Phase 2 skip",
        'type: "changePhase", phase: "end"',
      ],
    },
    {
      file: "test/lua-real-script-mischief-time-goddess-end-lock.test.ts",
      kind: "mischiefTimeGoddessEndTurnOnlyWindow",
      requiredSnippets: [
        'const mischiefCode = "92182447"',
        "restores its official opponent turn skip lock as an end-turn-only window",
        'type: "endTurn", player: 1',
      ],
    },
    {
      file: "test/lua-real-script-neko-mane-king-end-turn.test.ts",
      kind: "nekoManeKingMultiPhaseEndTurnLock",
      requiredSnippets: [
        'const nekoCode = "11021521"',
        "restores its official opponent Battle Phase lock with skipped phases",
        '{ player: 1, phase: "draw", remaining: 1 }',
      ],
    },
    {
      file: "test/lua-real-script-offerings-skip-draw.test.ts",
      kind: "offeringsDestroyDrawSkip",
      requiredSnippets: [
        'const offeringsCode = "19230407"',
        "restores Offerings to the Doomed's target destroy and registered Draw Phase skip",
        'skippedPhases).toEqual([{ player: 0, phase: "draw", remaining: 1 }])',
      ],
    },
    {
      file: "test/lua-real-script-photon-jumper-skip-battle.test.ts",
      kind: "photonJumperHandTriggerBattleSkip",
      requiredSnippets: [
        'const jumperCode = "97639441"',
        "restores its official hand trigger into a self-turn Battle Phase skip",
        'type: "changePhase", phase: "main2"',
      ],
    },
    {
      file: "test/lua-real-script-reckless-greed-draw-skip.test.ts",
      kind: "recklessGreedTwoDrawSkips",
      requiredSnippets: [
        'const recklessCode = "37576645"',
        "restores Reckless Greed's draw-two Trap activation and two Draw Phase skips",
        'skippedPhases).toEqual([{ player: 0, phase: "draw", remaining: 2 }])',
      ],
    },
    {
      file: "test/lua-real-script-super-junior-confrontation-calculate-damage.test.ts",
      kind: "superJuniorAttackNegationBattleSkip",
      requiredSnippets: [
        'const confrontationCode = "29590905"',
        "restores attack negation into script-selected CalculateDamage and Battle Phase skip",
        'battleWindow?.kind).toBe("attackNegationResponse")',
      ],
    },
    {
      file: "test/lua-real-script-terminal-world-skip-main2.test.ts",
      kind: "terminalWorldPersistentMain2Skip",
      requiredSnippets: [
        'const terminalWorldCode = "54631834"',
        "restores persistent EFFECT_SKIP_M2 legal actions from the official script",
        'type: "changePhase", phase: "main2"',
      ],
    },
    {
      file: "test/lua-real-script-timeater-skip-main1.test.ts",
      kind: "timeaterBattleDestroyMain1Skip",
      requiredSnippets: [
        'const timeaterCode = "44913552"',
        "restores its official battle-destroying trigger into an opponent Main Phase 1 skip",
        'type: "changePhase", phase: "battle"',
      ],
    },
    {
      file: "test/lua-real-script-yata-garasu-skip-draw.test.ts",
      kind: "yataGarasuBattleDamageDrawSkip",
      requiredSnippets: [
        'const yataCode = "3078576"',
        "restores its battle-damage trigger into the opponent's next Draw Phase skip",
        'skippedPhases).toEqual([{ player: 1, phase: "draw", remaining: 1 }])',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: PhaseSkipSemanticVariant;
    requiredSnippets: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countPhaseSkipSemanticVariants(
  fixtures: Array<{ kind: PhaseSkipSemanticVariant }>,
): Record<PhaseSkipSemanticVariant, number> {
  return fixtures.reduce<Record<PhaseSkipSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      amorphactorPainRitualMain1Skip: 0,
      burningBambooSwordChainingMain1Skip: 0,
      grandsoilLeaveSelfTurnBattleSkip: 0,
      greatLongNoseBattleDamageBattleSkip: 0,
      masterPeaceBattleDestroyMain2Skip: 0,
      mischiefTimeGoddessEndTurnOnlyWindow: 0,
      nekoManeKingMultiPhaseEndTurnLock: 0,
      offeringsDestroyDrawSkip: 0,
      photonJumperHandTriggerBattleSkip: 0,
      recklessGreedTwoDrawSkips: 0,
      superJuniorAttackNegationBattleSkip: 0,
      terminalWorldPersistentMain2Skip: 0,
      timeaterBattleDestroyMain1Skip: 0,
      yataGarasuBattleDamageDrawSkip: 0,
    },
  );
}
