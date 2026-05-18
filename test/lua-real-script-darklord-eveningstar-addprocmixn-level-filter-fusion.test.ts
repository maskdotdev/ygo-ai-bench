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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Darklord Eveningstar Fusion.AddProcMixN level filter metadata", () => {
  it("requires exactly two Level 6 or higher DARK Fairy materials from a local s.matfilter", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653";
    const eveningstarCode = "10136446";
    const highFairyOneCode = "10136447";
    const highFairyTwoCode = "10136448";
    const lowDarkFairyDecoyCode = "10136449";
    const highLightFairyDecoyCode = "10136450";
    const highDarkFiendDecoyCode = "10136451";
    const responderCode = "10136452";
    const typeMonster = 0x1;
    const raceFairy = 0x4;
    const raceFiend = 0x8;
    const attributeLight = 0x10;
    const attributeDark = 0x20;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [polymerizationCode, eveningstarCode].includes(card.code)),
      { code: highFairyOneCode, name: "Eveningstar High Dark Fairy One", kind: "monster", typeFlags: typeMonster, level: 6, race: raceFairy, attribute: attributeDark },
      { code: highFairyTwoCode, name: "Eveningstar High Dark Fairy Two", kind: "monster", typeFlags: typeMonster, level: 8, race: raceFairy, attribute: attributeDark },
      { code: lowDarkFairyDecoyCode, name: "Eveningstar Low Dark Fairy Decoy", kind: "monster", typeFlags: typeMonster, level: 5, race: raceFairy, attribute: attributeDark },
      { code: highLightFairyDecoyCode, name: "Eveningstar High Light Fairy Decoy", kind: "monster", typeFlags: typeMonster, level: 6, race: raceFairy, attribute: attributeLight },
      { code: highDarkFiendDecoyCode, name: "Eveningstar High Dark Fiend Decoy", kind: "monster", typeFlags: typeMonster, level: 6, race: raceFiend, attribute: attributeDark },
      { code: responderCode, name: "Eveningstar Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 10136446, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, highFairyOneCode, highFairyTwoCode, lowDarkFairyDecoyCode, highLightFairyDecoyCode, highDarkFiendDecoyCode], extra: [eveningstarCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const eveningstar = session.state.cards.find((card) => card.code === eveningstarCode);
    const materials = [highFairyOneCode, highFairyTwoCode].map((code) => session.state.cards.find((card) => card.code === code)!);
    const lowDarkFairyDecoy = session.state.cards.find((card) => card.code === lowDarkFairyDecoyCode);
    const highLightFairyDecoy = session.state.cards.find((card) => card.code === highLightFairyDecoyCode);
    const highDarkFiendDecoy = session.state.cards.find((card) => card.code === highDarkFiendDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(eveningstar).toBeDefined();
    expect(materials.every(Boolean)).toBe(true);
    expect(lowDarkFairyDecoy).toBeDefined();
    expect(highLightFairyDecoy).toBeDefined();
    expect(highDarkFiendDecoy).toBeDefined();
    expect(responder).toBeDefined();
    for (const card of [polymerization!, ...materials, lowDarkFairyDecoy!, highLightFairyDecoy!, highDarkFiendDecoy!]) moveDuelCard(session.state, card.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript(name: string) { return name === `c${responderCode}.lua` ? chainResponderScript() : workspace.readScript(name); } };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(polymerizationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(eveningstarCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(eveningstar!.data).toMatchObject({
      fusionMaterialMin: 2,
      fusionMaterialMax: 2,
      fusionMaterialLevelMin: 6,
      fusionMaterialAttribute: attributeDark,
      fusionMaterialRace: raceFairy,
    });

    const directFusionActions = getLegalActions(session, 0).filter((action): action is Extract<DuelAction, { type: "fusionSummon" }> => action.type === "fusionSummon" && action.uid === eveningstar!.uid);
    expect(directFusionActions).toHaveLength(1);
    expect(directFusionActions[0]!.materialUids).toEqual(materials.map((card) => card.uid));
    expect(directFusionActions.some((action) => action.materialUids.includes(lowDarkFairyDecoy!.uid))).toBe(false);
    expect(directFusionActions.some((action) => action.materialUids.includes(highLightFairyDecoy!.uid))).toBe(false);
    expect(directFusionActions.some((action) => action.materialUids.includes(highDarkFiendDecoy!.uid))).toBe(false);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === polymerization!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === eveningstar!.uid)?.data).toMatchObject({
      fusionMaterialMin: 2,
      fusionMaterialMax: 2,
      fusionMaterialLevelMin: 6,
      fusionMaterialAttribute: attributeDark,
      fusionMaterialRace: raceFairy,
    });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === eveningstar!.uid)).toMatchObject({
      location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true, summonType: "fusion", summonMaterialUids: materials.map((card) => card.uid),
    });
    for (const material of materials) expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.material | duelReason.fusion });
    expect(restored.session.state.cards.find((card) => card.uid === lowDarkFairyDecoy!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === highLightFairyDecoy!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === highDarkFiendDecoy!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.host.messages).not.toContain("eveningstar responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("eveningstar responder resolved") end)
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
