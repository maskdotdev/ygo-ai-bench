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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mirrorjade Fusion.AddProcMix plus-type metadata", () => {
  it("requires Fallen of Albaz plus one Fusion, Synchro, Xyz, or Link material from a plus-separated type predicate", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653", albazCode = "68468459", mirrorjadeCode = "44146295", linkMaterialCode = "44146296", normalDecoyCode = "44146297", responderCode = "44146298";
    const typeFusion = 0x40, typeSynchro = 0x2000, typeXyz = 0x800000, typeLink = 0x4000000;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [polymerizationCode, albazCode, mirrorjadeCode].includes(card.code)),
      { code: linkMaterialCode, name: "Mirrorjade Link Material", kind: "monster", typeFlags: 0x1 | typeLink, level: 4, race: 0x2000, attribute: 0x10, attack: 1800, defense: 1000 },
      { code: normalDecoyCode, name: "Mirrorjade Normal Decoy", kind: "monster", typeFlags: 0x1, level: 4, race: 0x2000, attribute: 0x10, attack: 1900, defense: 1000 },
      { code: responderCode, name: "Mirrorjade Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 44146295, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, albazCode, linkMaterialCode, normalDecoyCode], extra: [mirrorjadeCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const albaz = session.state.cards.find((card) => card.code === albazCode);
    const mirrorjade = session.state.cards.find((card) => card.code === mirrorjadeCode);
    const linkMaterial = session.state.cards.find((card) => card.code === linkMaterialCode);
    const normalDecoy = session.state.cards.find((card) => card.code === normalDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(albaz).toBeDefined();
    expect(mirrorjade).toBeDefined();
    expect(linkMaterial).toBeDefined();
    expect(normalDecoy).toBeDefined();
    expect(responder).toBeDefined();
    for (const card of [polymerization!, albaz!, linkMaterial!, normalDecoy!]) moveDuelCard(session.state, card.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript(name: string) { return name === `c${responderCode}.lua` ? chainResponderScript() : workspace.readScript(name); } };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(polymerizationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(albazCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(mirrorjadeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);
    expect(mirrorjade!.data.fusionRequiredMaterialPredicates).toEqual([{ type: typeFusion | typeSynchro | typeXyz | typeLink }]);
    expect(mirrorjade!.data.fusionMaterials).toEqual([albazCode]);

    const directFusionActions = getLegalActions(session, 0).filter((action): action is Extract<DuelAction, { type: "fusionSummon" }> => action.type === "fusionSummon" && action.uid === mirrorjade!.uid);
    expect(directFusionActions).toHaveLength(1);
    expect(directFusionActions[0]!.materialUids).toEqual([albaz!.uid, linkMaterial!.uid]);
    expect(directFusionActions.some((action) => action.materialUids.includes(normalDecoy!.uid))).toBe(false);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === polymerization!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === mirrorjade!.uid)?.data).toMatchObject({
      fusionMaterials: [albazCode],
      fusionRequiredMaterialPredicates: [{ type: typeFusion | typeSynchro | typeXyz | typeLink }],
    });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === mirrorjade!.uid)).toMatchObject({
      location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true, summonType: "fusion", summonMaterialUids: [albaz!.uid, linkMaterial!.uid],
    });
    for (const material of [albaz!, linkMaterial!]) expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.material | duelReason.fusion });
    expect(restored.session.state.cards.find((card) => card.uid === normalDecoy!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.host.messages).not.toContain("mirrorjade responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("mirrorjade responder resolved") end)
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
