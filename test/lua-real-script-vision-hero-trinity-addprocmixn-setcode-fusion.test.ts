import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Vision HERO Trinity Fusion.AddProcMixN setcode metadata", () => {
  it("requires exactly three HERO materials from a repeated setcode predicate", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653", trinityCode = "46759931", heroACode = "46759932", heroBCode = "46759933", heroCCode = "46759934", nonHeroCode = "46759935", responderCode = "46759936";
    const setHero = 0x8;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [polymerizationCode, trinityCode].includes(card.code)),
      { code: heroACode, name: "Trinity HERO Material A", kind: "monster", typeFlags: 0x21, level: 4, race: 0x1, attribute: 0x10, setcodes: [setHero], attack: 1400, defense: 1000 },
      { code: heroBCode, name: "Trinity HERO Material B", kind: "monster", typeFlags: 0x21, level: 4, race: 0x1, attribute: 0x10, setcodes: [setHero], attack: 1500, defense: 1000 },
      { code: heroCCode, name: "Trinity HERO Material C", kind: "monster", typeFlags: 0x21, level: 4, race: 0x1, attribute: 0x10, setcodes: [setHero], attack: 1600, defense: 1000 },
      { code: nonHeroCode, name: "Trinity Non-HERO Decoy", kind: "monster", typeFlags: 0x21, level: 4, race: 0x1, attribute: 0x10, setcodes: [0x123], attack: 1700, defense: 1000 },
      { code: responderCode, name: "Trinity Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 46759931, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, heroACode, heroBCode, heroCCode, nonHeroCode], extra: [trinityCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const trinity = session.state.cards.find((card) => card.code === trinityCode);
    const heroMaterials = [heroACode, heroBCode, heroCCode].map((code) => session.state.cards.find((card) => card.code === code)!);
    const nonHero = session.state.cards.find((card) => card.code === nonHeroCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(trinity).toBeDefined();
    expect(heroMaterials.every(Boolean)).toBe(true);
    expect(nonHero).toBeDefined();
    expect(responder).toBeDefined();
    for (const card of [polymerization!, ...heroMaterials, nonHero!]) moveDuelCard(session.state, card.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript(name: string) { return name === `c${responderCode}.lua` ? chainResponderScript() : workspace.readScript(name); } };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(polymerizationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(trinityCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(trinity!.data).toMatchObject({ fusionMaterialMin: 3, fusionMaterialMax: 3, fusionMaterialSetcode: setHero });
    expect(trinity!.data.fusionMaterials).toBeUndefined();

    const directFusionActions = getLegalActions(session, 0).filter((action): action is Extract<DuelAction, { type: "fusionSummon" }> => action.type === "fusionSummon" && action.uid === trinity!.uid);
    expect(directFusionActions).toHaveLength(1);
    expect(directFusionActions[0]!.materialUids).toEqual(heroMaterials.map((card) => card.uid));
    expect(directFusionActions.some((action) => action.materialUids.includes(nonHero!.uid))).toBe(false);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === polymerization!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === trinity!.uid)?.data).toMatchObject({ fusionMaterialMin: 3, fusionMaterialMax: 3, fusionMaterialSetcode: setHero });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === trinity!.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true, summonType: "fusion", summonMaterialUids: heroMaterials.map((card) => card.uid) });
    for (const material of heroMaterials) expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.material | duelReason.fusion });
    expect(restored.session.state.cards.find((card) => card.uid === nonHero!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.host.messages).not.toContain("trinity responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("trinity responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
