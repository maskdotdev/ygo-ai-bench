import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script continuous positive original Type Clock Lizard lock", () => {
  it("restores original Link continuous Clock Lizard checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "86993168";
    const linkCode = "86993169";
    const fusionCode = "86993170";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode),
      { code: linkCode, name: "Continuous Original Link Probe", kind: "extra", typeFlags: 0x4000001, race: 0x2000, attribute: 0x20, level: 2, attack: 1000, defense: 0 },
      { code: fusionCode, name: "Continuous Original Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x20, level: 6, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 869, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode], extra: [linkCode, fusionCode] }, 1: { main: [] } });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === sourceCode);
    expect(source).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    source!.faceUp = true;
    source!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${sourceCode}),0,LOCATION_MZONE,0,nil)
      local e3=aux.createContinuousLizardCheck(c,LOCATION_MZONE,function(_,c) return c:IsOriginalType(TYPE_LINK) end)
      e3:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_CONTROL)
      c:RegisterEffect(e3,true)
      `,
      "continuous-positive-original-type-official-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:original-type:67108864",
      range: ["monsterZone"],
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const restoredSource = restored.session.state.cards.find((card) => card.code === sourceCode);
    const link = restored.session.state.cards.find((card) => card.code === linkCode);
    const fusion = restored.session.state.cards.find((card) => card.code === fusionCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(restoredSource).toBeDefined();
    expect(link).toBeDefined();
    expect(fusion).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredSource!);
    expect(effect!.targetCardPredicate!(ctx, link!)).toBe(true);
    expect(effect!.targetCardPredicate!(ctx, fusion!)).toBe(false);
  });
});
