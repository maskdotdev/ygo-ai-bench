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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Azamina Moa Regina Fusion.AddProcMix named filter metadata", () => {
  it("requires an Illusion material plus a Level 6 or higher Fiend from local s.matfilter", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653", moaReginaCode = "46174776", illusionMaterialCode = "46174777", highFiendCode = "46174778", lowFiendDecoyCode = "46174779", highWarriorDecoyCode = "46174780", responderCode = "46174781";
    const typeMonster = 0x1, typeEffect = 0x20, raceWarrior = 0x1, raceFiend = 0x8, raceIllusion = 0x2000000, attributeDark = 0x20;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [polymerizationCode, moaReginaCode].includes(card.code)),
      { code: illusionMaterialCode, name: "Moa Regina Illusion Material", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, race: raceIllusion, attribute: attributeDark, attack: 1200, defense: 1000 },
      { code: highFiendCode, name: "Moa Regina High Fiend Material", kind: "monster", typeFlags: typeMonster | typeEffect, level: 6, race: raceFiend, attribute: attributeDark, attack: 1800, defense: 1000 },
      { code: lowFiendDecoyCode, name: "Moa Regina Low Fiend Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 5, race: raceFiend, attribute: attributeDark, attack: 1700, defense: 1000 },
      { code: highWarriorDecoyCode, name: "Moa Regina High Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 6, race: raceWarrior, attribute: attributeDark, attack: 1900, defense: 1000 },
      { code: responderCode, name: "Moa Regina Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 46174776, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, illusionMaterialCode, highFiendCode, lowFiendDecoyCode, highWarriorDecoyCode], extra: [moaReginaCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const moaRegina = session.state.cards.find((card) => card.code === moaReginaCode);
    const illusionMaterial = session.state.cards.find((card) => card.code === illusionMaterialCode);
    const highFiend = session.state.cards.find((card) => card.code === highFiendCode);
    const lowFiendDecoy = session.state.cards.find((card) => card.code === lowFiendDecoyCode);
    const highWarriorDecoy = session.state.cards.find((card) => card.code === highWarriorDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(moaRegina).toBeDefined();
    expect(illusionMaterial).toBeDefined();
    expect(highFiend).toBeDefined();
    expect(lowFiendDecoy).toBeDefined();
    expect(highWarriorDecoy).toBeDefined();
    expect(responder).toBeDefined();
    for (const card of [polymerization!, illusionMaterial!, highFiend!, lowFiendDecoy!, highWarriorDecoy!]) moveDuelCard(session.state, card.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript(name: string) { return name === `c${responderCode}.lua` ? chainResponderScript() : workspace.readScript(name); } };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(polymerizationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(moaReginaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(moaRegina!.data.fusionRequiredMaterialPredicates).toEqual([{ race: raceIllusion }, { levelMin: 6, race: raceFiend }]);
    expect(moaRegina!.data.fusionMaterials).toBeUndefined();

    const directFusionActions = getLegalActions(session, 0).filter((action): action is Extract<DuelAction, { type: "fusionSummon" }> => action.type === "fusionSummon" && action.uid === moaRegina!.uid);
    expect(directFusionActions).toHaveLength(1);
    expect(directFusionActions[0]!.materialUids).toEqual([illusionMaterial!.uid, highFiend!.uid]);
    expect(directFusionActions.some((action) => action.materialUids.includes(lowFiendDecoy!.uid))).toBe(false);
    expect(directFusionActions.some((action) => action.materialUids.includes(highWarriorDecoy!.uid))).toBe(false);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === polymerization!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === moaRegina!.uid)?.data).toMatchObject({
      fusionRequiredMaterialPredicates: [{ race: raceIllusion }, { levelMin: 6, race: raceFiend }],
    });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === moaRegina!.uid)).toMatchObject({
      location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true, summonType: "fusion", summonMaterialUids: [illusionMaterial!.uid, highFiend!.uid],
    });
    for (const material of [illusionMaterial!, highFiend!]) expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.material | duelReason.fusion });
    expect(restored.session.state.cards.find((card) => card.uid === lowFiendDecoy!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === highWarriorDecoy!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.host.messages).not.toContain("moa regina responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("moa regina responder resolved") end)
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
