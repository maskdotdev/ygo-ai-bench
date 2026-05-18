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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ultimate Ancient Gear Golem Fusion.AddProcMixN mixed metadata", () => {
  it("requires Ancient Gear Golem plus exactly two Ancient Gear repeated setcode materials", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653", ultimateGolemCode = "12652643", ancientGearGolemCode = "83104731", ancientGearACode = "12652644", ancientGearBCode = "12652645", offSetCode = "12652646", responderCode = "12652647";
    const setAncientGear = 0x7;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [polymerizationCode, ultimateGolemCode, ancientGearGolemCode].includes(card.code)),
      { code: ancientGearACode, name: "Ultimate Golem Ancient Gear Material A", kind: "monster", typeFlags: 0x21, level: 4, race: 0x20, attribute: 0x10, setcodes: [setAncientGear], attack: 1400, defense: 1000 },
      { code: ancientGearBCode, name: "Ultimate Golem Ancient Gear Material B", kind: "monster", typeFlags: 0x21, level: 4, race: 0x20, attribute: 0x10, setcodes: [setAncientGear], attack: 1500, defense: 1000 },
      { code: offSetCode, name: "Ultimate Golem Off-Set Decoy", kind: "monster", typeFlags: 0x21, level: 4, race: 0x20, attribute: 0x10, setcodes: [0x123], attack: 1600, defense: 1000 },
      { code: responderCode, name: "Ultimate Golem Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 12652643, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, ancientGearGolemCode, ancientGearACode, ancientGearBCode, offSetCode], extra: [ultimateGolemCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const ultimateGolem = session.state.cards.find((card) => card.code === ultimateGolemCode);
    const ancientGearGolem = session.state.cards.find((card) => card.code === ancientGearGolemCode);
    const ancientGearMaterials = [ancientGearACode, ancientGearBCode].map((code) => session.state.cards.find((card) => card.code === code)!);
    const offSet = session.state.cards.find((card) => card.code === offSetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(ultimateGolem).toBeDefined();
    expect(ancientGearGolem).toBeDefined();
    expect(ancientGearMaterials.every(Boolean)).toBe(true);
    expect(offSet).toBeDefined();
    expect(responder).toBeDefined();
    for (const card of [polymerization!, ancientGearGolem!, ...ancientGearMaterials, offSet!]) moveDuelCard(session.state, card.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript(name: string) { return name === `c${responderCode}.lua` ? chainResponderScript() : workspace.readScript(name); } };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(polymerizationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(ultimateGolemCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(ultimateGolem!.data).toMatchObject({ fusionMaterials: [ancientGearGolemCode], fusionMaterialMin: 2, fusionMaterialMax: 2, fusionMaterialSetcode: setAncientGear });

    const directFusionActions = getLegalActions(session, 0).filter((action): action is Extract<DuelAction, { type: "fusionSummon" }> => action.type === "fusionSummon" && action.uid === ultimateGolem!.uid);
    expect(directFusionActions).toHaveLength(1);
    expect(directFusionActions[0]!.materialUids).toEqual([ancientGearGolem!.uid, ...ancientGearMaterials.map((card) => card.uid)]);
    expect(directFusionActions.some((action) => action.materialUids.includes(offSet!.uid))).toBe(false);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === polymerization!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === ultimateGolem!.uid)?.data).toMatchObject({ fusionMaterials: [ancientGearGolemCode], fusionMaterialMin: 2, fusionMaterialMax: 2, fusionMaterialSetcode: setAncientGear });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === ultimateGolem!.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true, summonType: "fusion", summonMaterialUids: [ancientGearGolem!.uid, ...ancientGearMaterials.map((card) => card.uid)] });
    for (const material of [ancientGearGolem!, ...ancientGearMaterials]) expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.material | duelReason.fusion });
    expect(restored.session.state.cards.find((card) => card.uid === offSet!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.host.messages).not.toContain("ultimate golem responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("ultimate golem responder resolved") end)
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
