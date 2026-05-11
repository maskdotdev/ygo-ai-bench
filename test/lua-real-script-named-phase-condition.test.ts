import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: source.controller,
    targetUids: [],
    log: () => {},
    moveCard: () => source,
    negateChainLink: () => false,
    setTargets: () => {},
    getTargets: () => [],
    setTargetPlayer: () => {},
    setTargetParam: () => {},
  };
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script named phase conditions", () => {
  it("restores standalone named main, main2, and standby phase checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fabledCode = "21281085";
    const strikeFighterCode = "66122213";
    const clownCrewCode = "6547248";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [fabledCode, strikeFighterCode, clownCrewCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7316, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [fabledCode, strikeFighterCode], main: [clownCrewCode] }, 1: { main: [] } });
    startDuel(session);

    const fabled = session.state.cards.find((card) => card.code === fabledCode);
    const strikeFighter = session.state.cards.find((card) => card.code === strikeFighterCode);
    const clownCrew = session.state.cards.find((card) => card.code === clownCrewCode);
    expect(fabled).toBeDefined();
    expect(strikeFighter).toBeDefined();
    expect(clownCrew).toBeDefined();
    moveDuelCard(session.state, fabled!.uid, "monsterZone", 0);
    moveDuelCard(session.state, strikeFighter!.uid, "monsterZone", 0).sequence = 1;
    moveDuelCard(session.state, clownCrew!.uid, "spellTrapZone", 0);

    const host = createLuaScriptHost(session, workspace);
    for (const code of [fabledCode, strikeFighterCode, clownCrewCode]) expect(host.loadCardScript(Number(code), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ luaConditionDescriptor: "condition:main-phase", sourceUid: fabled!.uid }),
        expect.objectContaining({ luaConditionDescriptor: "condition:phase:256", sourceUid: strikeFighter!.uid }),
        expect.objectContaining({ luaConditionDescriptor: "condition:phase:2", sourceUid: clownCrew!.uid }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredFabled = restored.session.state.cards.find((card) => card.code === fabledCode);
    const restoredStrikeFighter = restored.session.state.cards.find((card) => card.code === strikeFighterCode);
    const restoredClownCrew = restored.session.state.cards.find((card) => card.code === clownCrewCode);
    const mainPhaseEffect = restored.session.state.effects.find((effect) => effect.sourceUid === fabled!.uid && effect.luaConditionDescriptor === "condition:main-phase");
    const main2Effect = restored.session.state.effects.find((effect) => effect.sourceUid === strikeFighter!.uid && effect.luaConditionDescriptor === "condition:phase:256");
    const standbyEffect = restored.session.state.effects.find((effect) => effect.sourceUid === clownCrew!.uid && effect.luaConditionDescriptor === "condition:phase:2");
    expect(mainPhaseEffect?.canActivate).toBeDefined();
    expect(main2Effect?.canActivate).toBeDefined();
    expect(standbyEffect?.canActivate).toBeDefined();
    restored.session.state.phase = "main1";
    expect(mainPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredFabled!))).toBe(true);
    expect(main2Effect!.canActivate!(targetContext(restored.session.state, restoredStrikeFighter!))).toBe(false);
    restored.session.state.phase = "main2";
    expect(mainPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredFabled!))).toBe(true);
    expect(main2Effect!.canActivate!(targetContext(restored.session.state, restoredStrikeFighter!))).toBe(true);
    restored.session.state.phase = "standby";
    expect(mainPhaseEffect!.canActivate!(targetContext(restored.session.state, restoredFabled!))).toBe(false);
    expect(standbyEffect!.canActivate!(targetContext(restored.session.state, restoredClownCrew!))).toBe(true);
  });
});
