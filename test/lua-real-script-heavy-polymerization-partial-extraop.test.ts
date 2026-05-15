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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Heavy Polymerization partial Fusion extraop", () => {
  it("restores Extra Deck material fcheck, banishes only Extra Deck materials, then sends remaining Fusion materials to the Graveyard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const heavyPolymerizationCode = "58570206";
    const handMaterialACode = "58570207";
    const handMaterialBCode = "58570208";
    const extraMaterialCode = "58570209";
    const fusionCode = "58570210";
    const opponentMonsterCode = "58570211";
    const responderCode = "58570212";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === heavyPolymerizationCode),
      { code: handMaterialACode, name: "Heavy Polymerization Hand Material A", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
      { code: handMaterialBCode, name: "Heavy Polymerization Hand Material B", kind: "monster", typeFlags: 0x21, level: 4, attack: 1100, defense: 1000 },
      { code: extraMaterialCode, name: "Heavy Polymerization Extra Deck Material", kind: "extra", typeFlags: 0x41, level: 4, attack: 1200, defense: 1000 },
      {
        code: fusionCode,
        name: "Heavy Polymerization Fusion Fixture",
        kind: "extra",
        typeFlags: 0x41,
        level: 8,
        attack: 3000,
        defense: 2500,
        fusionMaterials: [handMaterialACode, handMaterialBCode, extraMaterialCode],
      },
      { code: opponentMonsterCode, name: "Heavy Polymerization Opponent Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 900, defense: 900 },
      { code: responderCode, name: "Heavy Polymerization Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 585, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [heavyPolymerizationCode, handMaterialACode, handMaterialBCode], extra: [fusionCode, extraMaterialCode] },
      1: { main: [opponentMonsterCode, responderCode] },
    });
    startDuel(session);

    const heavyPolymerization = session.state.cards.find((card) => card.code === heavyPolymerizationCode);
    const handMaterialA = session.state.cards.find((card) => card.code === handMaterialACode);
    const handMaterialB = session.state.cards.find((card) => card.code === handMaterialBCode);
    const extraMaterial = session.state.cards.find((card) => card.code === extraMaterialCode);
    const fusion = session.state.cards.find((card) => card.code === fusionCode);
    const opponentMonster = session.state.cards.find((card) => card.code === opponentMonsterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(heavyPolymerization).toBeDefined();
    expect(handMaterialA).toBeDefined();
    expect(handMaterialB).toBeDefined();
    expect(extraMaterial).toBeDefined();
    expect(fusion).toBeDefined();
    expect(opponentMonster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, heavyPolymerization!.uid, "hand", 0);
    moveDuelCard(session.state, handMaterialA!.uid, "hand", 0);
    moveDuelCard(session.state, handMaterialB!.uid, "monsterZone", 0);
    moveDuelCard(session.state, opponentMonster!.uid, "monsterZone", 1);
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
    expect(host.loadCardScript(Number(heavyPolymerizationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === heavyPolymerization!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    const chainLink = session.state.chain[0]!;
    expect(chainLink.operationInfos).toEqual(expect.arrayContaining([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]));
    expect(chainLink.possibleOperationInfos).toEqual(expect.arrayContaining([{ category: 0x4, targetUids: [], count: 1, player: 0, parameter: 0x40 }]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    const restoredChainLink = restored.session.state.chain[0]!;
    expect(restoredChainLink.operationInfos).toEqual(expect.arrayContaining([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]));
    expect(restoredChainLink.possibleOperationInfos).toEqual(expect.arrayContaining([{ category: 0x4, targetUids: [], count: 1, player: 0, parameter: 0x40 }]));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === fusion!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: [handMaterialA!.uid, handMaterialB!.uid, extraMaterial!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === extraMaterial!.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === handMaterialA!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === handMaterialB!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.players[0].lifePoints).toBe(6800);
    expect(restored.session.state.cards.find((card) => card.uid === heavyPolymerization!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.host.messages).not.toContain("heavy polymerization responder resolved");
  });

  it("does not expose Heavy Polymerization when the Extra Deck material count exceeds the opponent's monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const heavyPolymerizationCode = "58570206";
    const handMaterialACode = "58570213";
    const handMaterialBCode = "58570214";
    const extraMaterialCode = "58570215";
    const fusionCode = "58570216";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === heavyPolymerizationCode),
      { code: handMaterialACode, name: "Heavy Polymerization No Opponent Material A", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
      { code: handMaterialBCode, name: "Heavy Polymerization No Opponent Material B", kind: "monster", typeFlags: 0x21, level: 4, attack: 1100, defense: 1000 },
      { code: extraMaterialCode, name: "Heavy Polymerization No Opponent Extra Material", kind: "extra", typeFlags: 0x41, level: 4, attack: 1200, defense: 1000 },
      {
        code: fusionCode,
        name: "Heavy Polymerization No Opponent Fusion Fixture",
        kind: "extra",
        typeFlags: 0x41,
        level: 8,
        attack: 3000,
        defense: 2500,
        fusionMaterials: [handMaterialACode, handMaterialBCode, extraMaterialCode],
      },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 586, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [heavyPolymerizationCode, handMaterialACode, handMaterialBCode], extra: [fusionCode, extraMaterialCode] }, 1: { main: [] } });
    startDuel(session);

    const heavyPolymerization = session.state.cards.find((card) => card.code === heavyPolymerizationCode);
    const handMaterialA = session.state.cards.find((card) => card.code === handMaterialACode);
    const handMaterialB = session.state.cards.find((card) => card.code === handMaterialBCode);
    expect(heavyPolymerization).toBeDefined();
    expect(handMaterialA).toBeDefined();
    expect(handMaterialB).toBeDefined();
    moveDuelCard(session.state, heavyPolymerization!.uid, "hand", 0);
    moveDuelCard(session.state, handMaterialA!.uid, "hand", 0);
    moveDuelCard(session.state, handMaterialB!.uid, "monsterZone", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(heavyPolymerizationCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === heavyPolymerization!.uid)).toBeUndefined();
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
      e:SetOperation(function(e,tp) Debug.Message("heavy polymerization responder resolved") end)
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
  return response;
}
