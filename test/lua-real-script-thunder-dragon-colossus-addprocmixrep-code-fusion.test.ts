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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Thunder Dragon Colossus Fusion.AddProcMixRep exact-code metadata", () => {
  it("restores repeated Thunder plus exact Thunder Dragon Fusion materials", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653";
    const colossusCode = "15291624";
    const thunderDragonCode = "31786629";
    const thunderDecoyCode = "15291625";
    const offRaceCode = "15291626";
    const responderCode = "15291627";
    const raceThunder = 0x1000;
    const wantedCodes = [polymerizationCode, colossusCode, thunderDragonCode];
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => wantedCodes.includes(card.code)),
      { code: thunderDecoyCode, name: "Colossus Thunder Material", kind: "monster", typeFlags: 0x1, level: 4, race: raceThunder, attribute: 0x10 },
      { code: offRaceCode, name: "Colossus Off-Race Material", kind: "monster", typeFlags: 0x1, level: 4, race: 0x20, attribute: 0x10 },
      { code: responderCode, name: "Colossus Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 15291624, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, thunderDragonCode, thunderDecoyCode, offRaceCode], extra: [colossusCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const colossus = session.state.cards.find((card) => card.code === colossusCode);
    const thunderDragon = session.state.cards.find((card) => card.code === thunderDragonCode);
    const thunderDecoy = session.state.cards.find((card) => card.code === thunderDecoyCode);
    const offRace = session.state.cards.find((card) => card.code === offRaceCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(colossus).toBeDefined();
    expect(thunderDragon).toBeDefined();
    expect(thunderDecoy).toBeDefined();
    expect(offRace).toBeDefined();
    expect(responder).toBeDefined();
    for (const card of [polymerization!, thunderDragon!, thunderDecoy!, offRace!]) moveDuelCard(session.state, card.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(colossusCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(colossus!.data.fusionMaterials).toEqual([thunderDragonCode]);
    expect(colossus!.data.fusionMaterialMin).toBe(1);
    expect(colossus!.data.fusionMaterialMax).toBe(1);
    expect(colossus!.data.fusionMaterialRace).toBe(raceThunder);

    const directFusionActions = getLegalActions(session, 0).filter((action): action is Extract<DuelAction, { type: "fusionSummon" }> => action.type === "fusionSummon" && action.uid === colossus!.uid);
    expect(directFusionActions).toHaveLength(1);
    expect(directFusionActions.every((action) => action.materialUids.length === 2 && action.materialUids.includes(thunderDragon!.uid))).toBe(true);
    expect(directFusionActions.some((action) => action.materialUids.join("|") === [thunderDragon!.uid, thunderDecoy!.uid].join("|"))).toBe(true);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === polymerization!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === colossus!.uid)?.data).toMatchObject({
      fusionMaterials: [thunderDragonCode],
      fusionMaterialMin: 1,
      fusionMaterialMax: 1,
      fusionMaterialRace: raceThunder,
    });
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 },
    ]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === colossus!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: [thunderDragon!.uid, thunderDecoy!.uid],
    });
    for (const material of [thunderDragon!, thunderDecoy!]) {
      expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.effect | duelReason.material | duelReason.fusion,
      });
    }
    expect(restored.session.state.cards.find((card) => card.uid === offRace!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "usedAsMaterial").map((event) => event.eventCardUid)).toEqual([thunderDragon!.uid, thunderDecoy!.uid]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      cardUid: event.eventCardUid,
      reason: event.eventReason,
      reasonCardUid: event.eventReasonCardUid,
      reasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        cardUid: colossus!.uid,
        reason: duelReason.summon | duelReason.specialSummon | duelReason.fusion,
        reasonCardUid: polymerization!.uid,
        reasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).not.toContain("colossus responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("colossus responder resolved") end)
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
