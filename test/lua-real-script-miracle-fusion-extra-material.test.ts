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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Miracle Fusion extra material Fusion Summon", () => {
  it("restores graveyard Fusion materials and banishes them through Fusion.BanishMaterial", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const miracleFusionCode = "45906428";
    const materialACode = "4590";
    const materialBCode = "4591";
    const fusionCode = "4592";
    const responderCode = "4593";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === miracleFusionCode),
      { code: materialACode, name: "Miracle Fusion Material A Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1000 },
      { code: materialBCode, name: "Miracle Fusion Material B Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1300, defense: 1000 },
      {
        code: fusionCode,
        name: "Elemental HERO Miracle Fusion Fixture",
        kind: "extra",
        typeFlags: 0x41,
        setcodes: [0x3008],
        level: 6,
        attack: 2200,
        defense: 1800,
        fusionMaterials: [materialACode, materialBCode],
      },
      { code: responderCode, name: "Miracle Fusion Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 459, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [miracleFusionCode, materialACode, materialBCode], extra: [fusionCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const miracleFusion = session.state.cards.find((card) => card.code === miracleFusionCode);
    const materialA = session.state.cards.find((card) => card.code === materialACode);
    const materialB = session.state.cards.find((card) => card.code === materialBCode);
    const fusion = session.state.cards.find((card) => card.code === fusionCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(miracleFusion).toBeDefined();
    expect(materialA).toBeDefined();
    expect(materialB).toBeDefined();
    expect(fusion).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, miracleFusion!.uid, "hand", 0);
    moveDuelCard(session.state, materialA!.uid, "graveyard", 0);
    moveDuelCard(session.state, materialB!.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(miracleFusionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === miracleFusion!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    const chainLink = session.state.chain[0]!;
    expect(chainLink.operationInfos).toEqual(
      expect.arrayContaining([
        { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 },
        { category: 0x4, targetUids: [], count: 1, player: 0, parameter: 0x14 },
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredChainLink = restored.session.state.chain[0]!;
    expect(restoredChainLink.operationInfos).toEqual(
      expect.arrayContaining([
        { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 },
        { category: 0x4, targetUids: [], count: 1, player: 0, parameter: 0x14 },
      ]),
    );
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
      summonMaterialUids: [materialA!.uid, materialB!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === materialA!.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === materialB!.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === miracleFusion!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "banished", eventCardUid: materialA!.uid }),
        expect.objectContaining({ eventName: "banished", eventCardUid: materialB!.uid }),
        expect.objectContaining({ eventName: "specialSummoned", eventCardUid: fusion!.uid }),
      ]),
    );
    expect(restored.host.messages).not.toContain("miracle fusion responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("miracle fusion responder resolved") end)
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
