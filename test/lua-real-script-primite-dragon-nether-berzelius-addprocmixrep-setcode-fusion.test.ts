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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Primite Dragon Nether Berzelius Fusion.AddProcMixRep setcode metadata", () => {
  it("requires one Primite material plus repeated Normal Monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653";
    const berzeliusCode = "26462013";
    const primiteMaterialCode = "26462014";
    const normalMaterialCode = "26462015";
    const normalDecoyCode = "26462016";
    const responderCode = "26462017";
    const setPrimite = 0x1b0;
    const typeNormal = 0x10;
    const wantedCodes = [polymerizationCode, berzeliusCode];
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => wantedCodes.includes(card.code)),
      { code: primiteMaterialCode, name: "Berzelius Primite Material", kind: "monster", typeFlags: 0x21, level: 4, race: 0x2000, attribute: 0x10, setcodes: [setPrimite] },
      { code: normalMaterialCode, name: "Berzelius Normal Material", kind: "monster", typeFlags: 0x11, level: 4, race: 0x2000, attribute: 0x10 },
      { code: normalDecoyCode, name: "Berzelius Normal Decoy", kind: "monster", typeFlags: 0x11, level: 4, race: 0x2000, attribute: 0x10 },
      { code: responderCode, name: "Berzelius Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 26462013, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, primiteMaterialCode, normalMaterialCode, normalDecoyCode], extra: [berzeliusCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const berzelius = session.state.cards.find((card) => card.code === berzeliusCode);
    const primiteMaterial = session.state.cards.find((card) => card.code === primiteMaterialCode);
    const normalMaterial = session.state.cards.find((card) => card.code === normalMaterialCode);
    const normalDecoy = session.state.cards.find((card) => card.code === normalDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(berzelius).toBeDefined();
    expect(primiteMaterial).toBeDefined();
    expect(normalMaterial).toBeDefined();
    expect(normalDecoy).toBeDefined();
    expect(responder).toBeDefined();
    for (const card of [polymerization!, primiteMaterial!, normalMaterial!, normalDecoy!]) moveDuelCard(session.state, card.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(berzeliusCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(berzelius!.data.fusionMaterials).toBeUndefined();
    expect(berzelius!.data.fusionRequiredMaterialSetcodes).toEqual([setPrimite]);
    expect(berzelius!.data.fusionMaterialMin).toBe(1);
    expect(berzelius!.data.fusionMaterialMax).toBe(99);
    expect(berzelius!.data.fusionMaterialType).toBe(typeNormal);

    const directFusionActions = getLegalActions(session, 0).filter((action): action is Extract<DuelAction, { type: "fusionSummon" }> => action.type === "fusionSummon" && action.uid === berzelius!.uid);
    expect(directFusionActions).toHaveLength(3);
    expect(directFusionActions.every((action) => action.materialUids.includes(primiteMaterial!.uid))).toBe(true);
    expect(directFusionActions.some((action) => action.materialUids.join("|") === [normalMaterial!.uid, normalDecoy!.uid].join("|"))).toBe(false);

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
    expect(restored.session.state.cards.find((card) => card.uid === berzelius!.uid)?.data).toMatchObject({
      fusionRequiredMaterialSetcodes: [setPrimite],
      fusionMaterialMin: 1,
      fusionMaterialMax: 99,
      fusionMaterialType: typeNormal,
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

    expect(restored.session.state.cards.find((card) => card.uid === berzelius!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: [primiteMaterial!.uid, normalMaterial!.uid],
    });
    for (const material of [primiteMaterial!, normalMaterial!]) {
      expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.effect | duelReason.material | duelReason.fusion,
      });
    }
    expect(restored.session.state.cards.find((card) => card.uid === normalDecoy!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.host.messages).not.toContain("berzelius responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("berzelius responder resolved") end)
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
