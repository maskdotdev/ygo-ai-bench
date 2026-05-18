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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Blaze Fenix Fusion.AddProcFun2 metadata", () => {
  it("requires one Machine and one Pyro material from two AddProcFun2 predicate slots", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653";
    const blazeFenixCode = "6602300";
    const machineMaterialCode = "6602301";
    const pyroMaterialCode = "6602302";
    const warriorDecoyCode = "6602303";
    const responderCode = "6602304";
    const raceMachine = 0x20;
    const racePyro = 0x80;
    const raceWarrior = 0x1;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [polymerizationCode, blazeFenixCode].includes(card.code)),
      { code: machineMaterialCode, name: "Blaze Fenix Machine Material", kind: "monster", typeFlags: 0x21, level: 4, race: raceMachine, attribute: 0x10, attack: 1400, defense: 1000 },
      { code: pyroMaterialCode, name: "Blaze Fenix Pyro Material", kind: "monster", typeFlags: 0x21, level: 4, race: racePyro, attribute: 0x10, attack: 1500, defense: 1000 },
      { code: warriorDecoyCode, name: "Blaze Fenix Warrior Decoy", kind: "monster", typeFlags: 0x21, level: 4, race: raceWarrior, attribute: 0x10, attack: 1600, defense: 1000 },
      { code: responderCode, name: "Blaze Fenix Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6602300, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, machineMaterialCode, pyroMaterialCode, warriorDecoyCode], extra: [blazeFenixCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const blazeFenix = session.state.cards.find((card) => card.code === blazeFenixCode);
    const machineMaterial = session.state.cards.find((card) => card.code === machineMaterialCode);
    const pyroMaterial = session.state.cards.find((card) => card.code === pyroMaterialCode);
    const warriorDecoy = session.state.cards.find((card) => card.code === warriorDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(blazeFenix).toBeDefined();
    expect(machineMaterial).toBeDefined();
    expect(pyroMaterial).toBeDefined();
    expect(warriorDecoy).toBeDefined();
    expect(responder).toBeDefined();
    for (const card of [polymerization!, machineMaterial!, pyroMaterial!, warriorDecoy!]) moveDuelCard(session.state, card.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(blazeFenixCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(blazeFenix!.data.fusionRequiredMaterialPredicates).toEqual([{ race: raceMachine }, { race: racePyro }]);
    expect(blazeFenix!.data.fusionMaterials).toBeUndefined();

    const directFusionActions = getLegalActions(session, 0).filter((action): action is Extract<DuelAction, { type: "fusionSummon" }> => action.type === "fusionSummon" && action.uid === blazeFenix!.uid);
    expect(directFusionActions).toHaveLength(1);
    expect(directFusionActions[0]!.materialUids).toEqual([machineMaterial!.uid, pyroMaterial!.uid]);
    expect(directFusionActions.some((action) => action.materialUids.includes(warriorDecoy!.uid))).toBe(false);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === polymerization!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === blazeFenix!.uid)?.data.fusionRequiredMaterialPredicates).toEqual([{ race: raceMachine }, { race: racePyro }]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === blazeFenix!.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true, summonType: "fusion", summonMaterialUids: [machineMaterial!.uid, pyroMaterial!.uid] });
    for (const material of [machineMaterial!, pyroMaterial!]) expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.material | duelReason.fusion });
    expect(restored.session.state.cards.find((card) => card.uid === warriorDecoy!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.host.messages).not.toContain("blaze fenix responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("blaze fenix responder resolved") end)
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
