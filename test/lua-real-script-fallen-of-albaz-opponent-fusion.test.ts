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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fallen of Albaz opponent-field Fusion", () => {
  it("restores a Fusion Summon using Albaz and an opponent monster as material", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const albazCode = "68468459";
    const discardCostCode = "68468460";
    const opponentMaterialCode = "68468461";
    const fusionCode = "68468462";
    const responderCode = "68468467";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === albazCode),
      { code: discardCostCode, name: "Fallen of Albaz Discard Cost Fixture", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
      { code: opponentMaterialCode, name: "Fallen of Albaz Opponent Material Fixture", kind: "monster", typeFlags: 0x21, level: 4, attack: 1500, defense: 1200 },
      {
        code: fusionCode,
        name: "Fallen of Albaz Opponent Fusion Fixture",
        kind: "extra",
        typeFlags: 0x41,
        level: 8,
        attack: 2500,
        defense: 2000,
        fusionMaterials: [albazCode, opponentMaterialCode],
      },
      { code: responderCode, name: "Fallen of Albaz Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 684, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [albazCode, discardCostCode], extra: [fusionCode] }, 1: { main: [opponentMaterialCode, responderCode] } });
    startDuel(session);

    const albaz = session.state.cards.find((card) => card.code === albazCode);
    const discardCost = session.state.cards.find((card) => card.code === discardCostCode);
    const opponentMaterial = session.state.cards.find((card) => card.code === opponentMaterialCode);
    const fusion = session.state.cards.find((card) => card.code === fusionCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(albaz).toBeDefined();
    expect(discardCost).toBeDefined();
    expect(opponentMaterial).toBeDefined();
    expect(fusion).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, albaz!.uid, "hand", 0);
    moveDuelCard(session.state, discardCost!.uid, "hand", 0);
    moveDuelCard(session.state, opponentMaterial!.uid, "monsterZone", 1);
    opponentMaterial!.faceUp = true;
    opponentMaterial!.position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(albazCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const summon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === albaz!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.uid === albaz!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.cards.find((card) => card.uid === discardCost!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    const waitingFor = restored.session.state.waitingFor!;
    expect(getLuaRestoreLegalActionGroups(restored, waitingFor)).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
    expect(getLuaRestoreLegalActionGroups(restored, waitingFor).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, waitingFor));

    const pass = getLuaRestoreLegalActions(restored, waitingFor).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === fusion!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: [albaz!.uid, opponentMaterial!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === albaz!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === opponentMaterial!.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.host.messages).not.toContain("fallen of albaz responder resolved");
  });

  it("does not expose the summon-success trigger when the Fusion target cannot use Albaz", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const albazCode = "68468459";
    const discardCostCode = "68468463";
    const ownMaterialCode = "68468464";
    const opponentMaterialCode = "68468465";
    const fusionCode = "68468466";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === albazCode),
      { code: discardCostCode, name: "Fallen of Albaz Negative Discard Cost", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
      { code: ownMaterialCode, name: "Fallen of Albaz Non-Handler Own Material", kind: "monster", typeFlags: 0x21, level: 4, attack: 1200, defense: 1000 },
      { code: opponentMaterialCode, name: "Fallen of Albaz Negative Opponent Material", kind: "monster", typeFlags: 0x21, level: 4, attack: 1500, defense: 1200 },
      {
        code: fusionCode,
        name: "Fallen of Albaz No Handler Fusion Fixture",
        kind: "extra",
        typeFlags: 0x41,
        level: 8,
        attack: 2500,
        defense: 2000,
        fusionMaterials: [ownMaterialCode, opponentMaterialCode],
      },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 685, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [albazCode, discardCostCode, ownMaterialCode], extra: [fusionCode] }, 1: { main: [opponentMaterialCode] } });
    startDuel(session);

    const albaz = session.state.cards.find((card) => card.code === albazCode);
    const discardCost = session.state.cards.find((card) => card.code === discardCostCode);
    const ownMaterial = session.state.cards.find((card) => card.code === ownMaterialCode);
    const opponentMaterial = session.state.cards.find((card) => card.code === opponentMaterialCode);
    expect(albaz).toBeDefined();
    expect(discardCost).toBeDefined();
    expect(ownMaterial).toBeDefined();
    expect(opponentMaterial).toBeDefined();
    moveDuelCard(session.state, albaz!.uid, "hand", 0);
    moveDuelCard(session.state, discardCost!.uid, "hand", 0);
    moveDuelCard(session.state, ownMaterial!.uid, "monsterZone", 0);
    ownMaterial!.faceUp = true;
    ownMaterial!.position = "faceUpAttack";
    moveDuelCard(session.state, opponentMaterial!.uid, "monsterZone", 1);
    opponentMaterial!.faceUp = true;
    opponentMaterial!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(albazCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const summon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === albaz!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);

    expect(getLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.uid === albaz!.uid)).toBeUndefined();
  });
});

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("fallen of albaz responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
