import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: 0,
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script original Attribute and Race Clock Lizard lock", () => {
  it("restores original EARTH Machine Clock Lizard checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "49296203";
    const earthMachineCode = "49296204";
    const fireMachineCode = "49296205";
    const earthWarriorCode = "49296206";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode),
      { code: earthMachineCode, name: "Original EARTH Machine Probe", kind: "extra", typeFlags: 0x41, race: 0x20, attribute: 0x1, level: 6, attack: 1000, defense: 1000 },
      { code: fireMachineCode, name: "Original FIRE Machine Probe", kind: "extra", typeFlags: 0x41, race: 0x20, attribute: 0x4, level: 6, attack: 1000, defense: 1000 },
      { code: earthWarriorCode, name: "Original EARTH Warrior Probe", kind: "extra", typeFlags: 0x41, race: 0x1, attribute: 0x1, level: 6, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 492, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode], extra: [earthMachineCode, fireMachineCode, earthWarriorCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${sourceCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,function(e,c) return not (c:IsOriginalAttribute(ATTRIBUTE_EARTH) and c:IsOriginalRace(RACE_MACHINE)) end)
      `,
      "original-attribute-race-official-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-attribute-race:1:32",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === sourceCode);
    const earthMachine = restored.session.state.cards.find((card) => card.code === earthMachineCode);
    const fireMachine = restored.session.state.cards.find((card) => card.code === fireMachineCode);
    const earthWarrior = restored.session.state.cards.find((card) => card.code === earthWarriorCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(earthMachine).toBeDefined();
    expect(fireMachine).toBeDefined();
    expect(earthWarrior).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, earthMachine!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, fireMachine!)).toBe(true);
    expect(effect!.targetCardPredicate!(ctx, earthWarrior!)).toBe(true);
  });
});
