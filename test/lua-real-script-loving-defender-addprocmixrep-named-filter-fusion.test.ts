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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Yubel Loving Defender Fusion.AddProcMixRep named filter metadata", () => {
  it("requires a Yubel material plus one or more on-field Effect monsters from a local s.ffilter", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653";
    const lovingDefenderCode = "47172959";
    const yubelMaterialCode = "47172960";
    const fieldEffectMaterialCode = "47172961";
    const handEffectDecoyCode = "47172962";
    const fieldNormalDecoyCode = "47172963";
    const offSetFieldEffectDecoyCode = "47172964";
    const responderCode = "47172965";
    const setYubel = 0x19d;
    const typeMonster = 0x1;
    const typeEffect = 0x20;
    const typeNormal = 0x10;
    const locationOnField = 0x0c;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [polymerizationCode, lovingDefenderCode].includes(card.code)),
      { code: yubelMaterialCode, name: "Loving Defender Yubel Material", kind: "monster", typeFlags: typeMonster | typeNormal, level: 4, race: 0x8, attribute: 0x20, setcodes: [setYubel], attack: 0, defense: 0 },
      { code: fieldEffectMaterialCode, name: "Loving Defender Field Effect Material", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, race: 0x8, attribute: 0x20, attack: 1200, defense: 1000 },
      { code: handEffectDecoyCode, name: "Loving Defender Hand Effect Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, race: 0x8, attribute: 0x20, attack: 1300, defense: 1000 },
      { code: fieldNormalDecoyCode, name: "Loving Defender Field Normal Decoy", kind: "monster", typeFlags: typeMonster | typeNormal, level: 4, race: 0x8, attribute: 0x20, attack: 1400, defense: 1000 },
      { code: offSetFieldEffectDecoyCode, name: "Loving Defender Off-Set Field Effect Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, race: 0x8, attribute: 0x20, attack: 1500, defense: 1000 },
      { code: responderCode, name: "Loving Defender Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 47172959, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, yubelMaterialCode, fieldEffectMaterialCode, handEffectDecoyCode, fieldNormalDecoyCode, offSetFieldEffectDecoyCode], extra: [lovingDefenderCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const lovingDefender = session.state.cards.find((card) => card.code === lovingDefenderCode);
    const yubelMaterial = session.state.cards.find((card) => card.code === yubelMaterialCode);
    const fieldEffectMaterial = session.state.cards.find((card) => card.code === fieldEffectMaterialCode);
    const handEffectDecoy = session.state.cards.find((card) => card.code === handEffectDecoyCode);
    const fieldNormalDecoy = session.state.cards.find((card) => card.code === fieldNormalDecoyCode);
    const offSetFieldEffectDecoy = session.state.cards.find((card) => card.code === offSetFieldEffectDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(lovingDefender).toBeDefined();
    expect(yubelMaterial).toBeDefined();
    expect(fieldEffectMaterial).toBeDefined();
    expect(handEffectDecoy).toBeDefined();
    expect(fieldNormalDecoy).toBeDefined();
    expect(offSetFieldEffectDecoy).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, polymerization!.uid, "hand", 0);
    moveDuelCard(session.state, yubelMaterial!.uid, "monsterZone", 0);
    moveDuelCard(session.state, fieldEffectMaterial!.uid, "monsterZone", 0);
    moveDuelCard(session.state, handEffectDecoy!.uid, "hand", 0);
    moveDuelCard(session.state, fieldNormalDecoy!.uid, "monsterZone", 0);
    moveDuelCard(session.state, offSetFieldEffectDecoy!.uid, "monsterZone", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(polymerizationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(lovingDefenderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(lovingDefender!.data).toMatchObject({
      fusionMaterialMin: 1,
      fusionMaterialMax: 99,
      fusionMaterialType: typeEffect,
      fusionMaterialLocation: locationOnField,
      fusionRequiredMaterialSetcodes: [setYubel],
    });

    const directFusionActions = getLegalActions(session, 0).filter((action): action is Extract<DuelAction, { type: "fusionSummon" }> => action.type === "fusionSummon" && action.uid === lovingDefender!.uid);
    expect(directFusionActions).toHaveLength(3);
    expect(directFusionActions.some((action) => sameMembers(action.materialUids, [yubelMaterial!.uid, fieldEffectMaterial!.uid]))).toBe(true);
    expect(directFusionActions.some((action) => action.materialUids.includes(handEffectDecoy!.uid))).toBe(false);
    expect(directFusionActions.some((action) => action.materialUids.includes(fieldNormalDecoy!.uid))).toBe(false);
    expect(directFusionActions.some((action) => action.materialUids.includes(offSetFieldEffectDecoy!.uid) && !action.materialUids.includes(fieldEffectMaterial!.uid))).toBe(true);
    expect(directFusionActions.some((action) => sameMembers(action.materialUids, [yubelMaterial!.uid, fieldEffectMaterial!.uid, offSetFieldEffectDecoy!.uid]))).toBe(true);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === polymerization!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === lovingDefender!.uid)?.data).toMatchObject({
      fusionMaterialMin: 1,
      fusionMaterialMax: 99,
      fusionMaterialType: typeEffect,
      fusionMaterialLocation: locationOnField,
      fusionRequiredMaterialSetcodes: [setYubel],
    });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === lovingDefender!.uid)).toMatchObject({
      location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true, summonType: "fusion", summonMaterialUids: [yubelMaterial!.uid, fieldEffectMaterial!.uid],
    });
    for (const material of [yubelMaterial!, fieldEffectMaterial!]) expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.material | duelReason.fusion });
    expect(restored.session.state.cards.find((card) => card.uid === handEffectDecoy!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === fieldNormalDecoy!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === offSetFieldEffectDecoy!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.host.messages).not.toContain("loving defender responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("loving defender responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function sameMembers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((uid) => actual.includes(uid));
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
