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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dracotail Shaulas Fusion.AddProcMix predicate metadata", () => {
  it("requires separate Dracotail and hand material predicates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653", shaulasCode = "42125140", dracotailMaterialCode = "42125141", handMaterialCode = "42125142", fieldDecoyCode = "42125143", responderCode = "42125144";
    const setDracotail = 0x1c0, locationHand = 0x02;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [polymerizationCode, shaulasCode].includes(card.code)),
      { code: dracotailMaterialCode, name: "Shaulas Dracotail Material", kind: "monster", typeFlags: 0x21, level: 4, race: 0x2000, attribute: 0x10, setcodes: [setDracotail] },
      { code: handMaterialCode, name: "Shaulas Hand Material", kind: "monster", typeFlags: 0x1, level: 4, race: 0x2000, attribute: 0x10 },
      { code: fieldDecoyCode, name: "Shaulas Field Decoy", kind: "monster", typeFlags: 0x1, level: 4, race: 0x2000, attribute: 0x10 },
      { code: responderCode, name: "Shaulas Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 42125140, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, dracotailMaterialCode, handMaterialCode, fieldDecoyCode], extra: [shaulasCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const shaulas = session.state.cards.find((card) => card.code === shaulasCode);
    const dracotailMaterial = session.state.cards.find((card) => card.code === dracotailMaterialCode);
    const handMaterial = session.state.cards.find((card) => card.code === handMaterialCode);
    const fieldDecoy = session.state.cards.find((card) => card.code === fieldDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(shaulas).toBeDefined();
    expect(dracotailMaterial).toBeDefined();
    expect(handMaterial).toBeDefined();
    expect(fieldDecoy).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, polymerization!.uid, "hand", 0);
    moveDuelCard(session.state, handMaterial!.uid, "hand", 0);
    moveDuelCard(session.state, dracotailMaterial!.uid, "monsterZone", 0);
    moveDuelCard(session.state, fieldDecoy!.uid, "monsterZone", 0);
    dracotailMaterial!.position = "faceUpAttack";
    fieldDecoy!.position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript(name: string) { return name === `c${responderCode}.lua` ? chainResponderScript() : workspace.readScript(name); } };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(polymerizationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(shaulasCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(shaulas!.data.fusionRequiredMaterialPredicates).toEqual([{ setcode: setDracotail }, { location: locationHand }]);
    expect(shaulas!.data.fusionMaterials).toBeUndefined();

    const directFusionActions = getLegalActions(session, 0).filter((action): action is Extract<DuelAction, { type: "fusionSummon" }> => action.type === "fusionSummon" && action.uid === shaulas!.uid);
    expect(directFusionActions).toHaveLength(1);
    expect(directFusionActions[0]!.materialUids).toEqual([dracotailMaterial!.uid, handMaterial!.uid]);
    expect(directFusionActions.some((action) => action.materialUids.includes(fieldDecoy!.uid))).toBe(false);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === polymerization!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === shaulas!.uid)?.data).toMatchObject({
      fusionRequiredMaterialPredicates: [{ setcode: setDracotail }, { location: locationHand }],
    });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === shaulas!.uid)).toMatchObject({
      location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true, summonType: "fusion", summonMaterialUids: [dracotailMaterial!.uid, handMaterial!.uid],
    });
    for (const material of [dracotailMaterial!, handMaterial!]) expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.material | duelReason.fusion });
    expect(restored.session.state.cards.find((card) => card.uid === fieldDecoy!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.host.messages).not.toContain("shaulas responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("shaulas responder resolved") end)
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
