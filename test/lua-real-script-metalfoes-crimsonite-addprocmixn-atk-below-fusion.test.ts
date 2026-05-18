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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Metalfoes Crimsonite Fusion.AddProcMixN attack-below repeated metadata", () => {
  it("requires one Metalfoes material plus exactly two 3000 or lower ATK repeated materials", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653", crimsoniteCode = "54401832", metalfoesMaterialCode = "54401833", lowMaterialACode = "54401834", lowMaterialBCode = "54401835", highDecoyCode = "54401836", responderCode = "54401837";
    const setMetalfoes = 0xe1;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [polymerizationCode, crimsoniteCode].includes(card.code)),
      { code: metalfoesMaterialCode, name: "Crimsonite Metalfoes Material", kind: "monster", typeFlags: 0x21, level: 4, race: 0x2000, attribute: 0x10, setcodes: [setMetalfoes], attack: 3100, defense: 1000 },
      { code: lowMaterialACode, name: "Crimsonite Low ATK Material A", kind: "monster", typeFlags: 0x21, level: 4, race: 0x2000, attribute: 0x10, attack: 2900, defense: 1000 },
      { code: lowMaterialBCode, name: "Crimsonite Low ATK Material B", kind: "monster", typeFlags: 0x21, level: 4, race: 0x2000, attribute: 0x10, attack: 3000, defense: 1000 },
      { code: highDecoyCode, name: "Crimsonite High ATK Decoy", kind: "monster", typeFlags: 0x21, level: 4, race: 0x2000, attribute: 0x10, attack: 3001, defense: 1000 },
      { code: responderCode, name: "Crimsonite Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 54401832, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, metalfoesMaterialCode, lowMaterialACode, lowMaterialBCode, highDecoyCode], extra: [crimsoniteCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const crimsonite = session.state.cards.find((card) => card.code === crimsoniteCode);
    const metalfoesMaterial = session.state.cards.find((card) => card.code === metalfoesMaterialCode);
    const lowMaterials = [lowMaterialACode, lowMaterialBCode].map((code) => session.state.cards.find((card) => card.code === code)!);
    const highDecoy = session.state.cards.find((card) => card.code === highDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(crimsonite).toBeDefined();
    expect(metalfoesMaterial).toBeDefined();
    expect(lowMaterials.every(Boolean)).toBe(true);
    expect(highDecoy).toBeDefined();
    expect(responder).toBeDefined();
    for (const card of [polymerization!, metalfoesMaterial!, ...lowMaterials, highDecoy!]) moveDuelCard(session.state, card.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript(name: string) { return name === `c${responderCode}.lua` ? chainResponderScript() : workspace.readScript(name); } };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(polymerizationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(crimsoniteCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(crimsonite!.data).toMatchObject({
      fusionRequiredMaterialSetcodes: [setMetalfoes],
      fusionMaterialAttackMax: 3000,
      fusionMaterialMin: 2,
      fusionMaterialMax: 2,
    });
    expect(crimsonite!.data.fusionMaterials).toBeUndefined();

    const directFusionActions = getLegalActions(session, 0).filter((action): action is Extract<DuelAction, { type: "fusionSummon" }> => action.type === "fusionSummon" && action.uid === crimsonite!.uid);
    expect(directFusionActions).toHaveLength(1);
    expect(directFusionActions[0]!.materialUids).toEqual([metalfoesMaterial!.uid, ...lowMaterials.map((card) => card.uid)]);
    expect(directFusionActions.some((action) => action.materialUids.includes(highDecoy!.uid))).toBe(false);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === polymerization!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === crimsonite!.uid)?.data).toMatchObject({
      fusionRequiredMaterialSetcodes: [setMetalfoes],
      fusionMaterialAttackMax: 3000,
      fusionMaterialMin: 2,
      fusionMaterialMax: 2,
    });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === crimsonite!.uid)).toMatchObject({
      location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true, summonType: "fusion", summonMaterialUids: [metalfoesMaterial!.uid, ...lowMaterials.map((card) => card.uid)],
    });
    for (const material of [metalfoesMaterial!, ...lowMaterials]) expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.material | duelReason.fusion });
    expect(restored.session.state.cards.find((card) => card.uid === highDecoy!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.host.messages).not.toContain("crimsonite responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("crimsonite responder resolved") end)
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
