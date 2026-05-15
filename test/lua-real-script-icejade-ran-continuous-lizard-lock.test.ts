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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Icejade Ran Aegirine continuous Clock Lizard lock", () => {
  it("restores its continuous non-WATER Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const icejadeCode = "18494511";
    const waterCode = "18494512";
    const fireCode = "18494513";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === icejadeCode),
      { code: waterCode, name: "Icejade Lizard WATER Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x2, level: 4, attack: 1000, defense: 1000 },
      { code: fireCode, name: "Icejade Lizard FIRE Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x4, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 184, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [icejadeCode], extra: [waterCode, fireCode] }, 1: { main: [] } });
    startDuel(session);
    const icejade = session.state.cards.find((card) => card.code === icejadeCode);
    expect(icejade).toBeDefined();
    moveDuelCard(session.state, icejade!.uid, "monsterZone", 0);
    icejade!.faceUp = true;
    icejade!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(icejadeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${icejadeCode}),0,LOCATION_MZONE,0,nil)
      local e2=aux.createContinuousLizardCheck(c,LOCATION_MZONE,function(_,c) return not c:IsAttribute(ATTRIBUTE_WATER) end)
      e2:SetReset(RESET_EVENT|RESETS_STANDARD)
      c:RegisterEffect(e2,true)
      `,
      "icejade-ran-official-continuous-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-attribute:2",
      range: ["monsterZone"],
      reset: { flags: 0x1fe1000 },
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
    expect(effect).toMatchObject({ reset: { flags: 0x1fe1000 } });
    const source = restored.session.state.cards.find((card) => card.code === icejadeCode);
    const water = restored.session.state.cards.find((card) => card.code === waterCode);
    const fire = restored.session.state.cards.find((card) => card.code === fireCode);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(water).toBeDefined();
    expect(fire).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, water!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, fire!)).toBe(true);
  });
});
