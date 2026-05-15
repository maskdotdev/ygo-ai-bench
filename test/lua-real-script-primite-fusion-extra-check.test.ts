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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Primite Fusion extra material check", () => {
  it("restores extra material fcheck and shuffles a Normal Monster material into the Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const primiteFusionCode = "99161253";
    const normalMaterialCode = "9916";
    const effectMaterialCode = "9917";
    const fusionCode = "9918";
    const responderCode = "9919";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === primiteFusionCode),
      { code: normalMaterialCode, name: "Primite Normal Dragon Fixture", kind: "monster", typeFlags: 0x11, race: 0x2000, level: 4, attack: 1200, defense: 1000 },
      { code: effectMaterialCode, name: "Primite Effect Dragon Fixture", kind: "monster", typeFlags: 0x21, race: 0x2000, level: 4, attack: 1300, defense: 1000 },
      {
        code: fusionCode,
        name: "Primite Dragon Fusion Fixture",
        kind: "extra",
        typeFlags: 0x41,
        race: 0x2000,
        level: 6,
        attack: 2200,
        defense: 1800,
        fusionMaterials: [normalMaterialCode, effectMaterialCode],
      },
      { code: responderCode, name: "Primite Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 991, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [primiteFusionCode, normalMaterialCode, effectMaterialCode], extra: [fusionCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const primiteFusion = session.state.cards.find((card) => card.code === primiteFusionCode);
    const normalMaterial = session.state.cards.find((card) => card.code === normalMaterialCode);
    const effectMaterial = session.state.cards.find((card) => card.code === effectMaterialCode);
    const fusion = session.state.cards.find((card) => card.code === fusionCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(primiteFusion).toBeDefined();
    expect(normalMaterial).toBeDefined();
    expect(effectMaterial).toBeDefined();
    expect(fusion).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, primiteFusion!.uid, "hand", 0);
    moveDuelCard(session.state, normalMaterial!.uid, "monsterZone", 0);
    moveDuelCard(session.state, effectMaterial!.uid, "monsterZone", 0);
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
    expect(host.loadCardScript(Number(primiteFusionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === primiteFusion!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    const chainLink = session.state.chain[0]!;
    expect(chainLink.operationInfos).toEqual(
      expect.arrayContaining([
        { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 },
        { category: 0x10, targetUids: [], count: 1, player: 0, parameter: 0x3c },
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    const restoredChainLink = restored.session.state.chain[0]!;
    expect(restoredChainLink.operationInfos).toEqual(
      expect.arrayContaining([
        { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 },
        { category: 0x10, targetUids: [], count: 1, player: 0, parameter: 0x3c },
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
      summonMaterialUids: [normalMaterial!.uid, effectMaterial!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === normalMaterial!.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === effectMaterial!.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.host.messages).not.toContain("primite responder resolved");
  });

  it("does not expose Primite Fusion when the selected material set has no Normal Monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const primiteFusionCode = "99161253";
    const materialACode = "9920";
    const materialBCode = "9921";
    const fusionCode = "9922";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === primiteFusionCode),
      { code: materialACode, name: "Primite Effect Dragon A Fixture", kind: "monster", typeFlags: 0x21, race: 0x2000, level: 4, attack: 1200, defense: 1000 },
      { code: materialBCode, name: "Primite Effect Dragon B Fixture", kind: "monster", typeFlags: 0x21, race: 0x2000, level: 4, attack: 1300, defense: 1000 },
      {
        code: fusionCode,
        name: "Primite No Normal Fusion Fixture",
        kind: "extra",
        typeFlags: 0x41,
        race: 0x2000,
        level: 6,
        attack: 2200,
        defense: 1800,
        fusionMaterials: [materialACode, materialBCode],
      },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 992, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [primiteFusionCode, materialACode, materialBCode], extra: [fusionCode] }, 1: { main: [] } });
    startDuel(session);

    const primiteFusion = session.state.cards.find((card) => card.code === primiteFusionCode);
    const materialA = session.state.cards.find((card) => card.code === materialACode);
    const materialB = session.state.cards.find((card) => card.code === materialBCode);
    expect(primiteFusion).toBeDefined();
    expect(materialA).toBeDefined();
    expect(materialB).toBeDefined();
    moveDuelCard(session.state, primiteFusion!.uid, "hand", 0);
    moveDuelCard(session.state, materialA!.uid, "monsterZone", 0);
    moveDuelCard(session.state, materialB!.uid, "monsterZone", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(primiteFusionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === primiteFusion!.uid)).toBeUndefined();
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
      e:SetOperation(function(e,tp) Debug.Message("primite responder resolved") end)
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
