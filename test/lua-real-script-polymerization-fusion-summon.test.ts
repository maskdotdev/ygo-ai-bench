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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Polymerization Fusion Summon", () => {
  it("restores Polymerization's registered Fusion Summon effect and resolves selected hand materials", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653";
    const materialACode = "2409";
    const materialBCode = "2410";
    const fusionCode = "2411";
    const responderCode = "2412";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === polymerizationCode),
      { code: materialACode, name: "Polymerization Material A Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1000 },
      { code: materialBCode, name: "Polymerization Material B Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1300, defense: 1000 },
      {
        code: fusionCode,
        name: "Polymerization Fusion Fixture",
        kind: "extra",
        typeFlags: 0x41,
        level: 6,
        attack: 2200,
        defense: 1800,
        fusionMaterials: [materialACode, materialBCode],
      },
      { code: responderCode, name: "Polymerization Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 240, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, materialACode, materialBCode], extra: [fusionCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const materialA = session.state.cards.find((card) => card.code === materialACode);
    const materialB = session.state.cards.find((card) => card.code === materialBCode);
    const fusion = session.state.cards.find((card) => card.code === fusionCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(materialA).toBeDefined();
    expect(materialB).toBeDefined();
    expect(fusion).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, polymerization!.uid, "hand", 0);
    moveDuelCard(session.state, materialA!.uid, "hand", 0);
    moveDuelCard(session.state, materialB!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === polymerization!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: polymerization!.uid,
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }],
    });
    expect(session.state.cards.find((card) => card.uid === fusion!.uid)).toMatchObject({ location: "extraDeck" });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chain[0]).toMatchObject({
      sourceUid: polymerization!.uid,
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }],
    });
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
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === materialB!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === polymerization!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "preUsedAsMaterial", eventCardUid: materialA!.uid }),
        expect.objectContaining({ eventName: "usedAsMaterial", eventCardUid: materialA!.uid }),
        expect.objectContaining({ eventName: "preUsedAsMaterial", eventCardUid: materialB!.uid }),
        expect.objectContaining({ eventName: "usedAsMaterial", eventCardUid: materialB!.uid }),
        expect.objectContaining({ eventName: "specialSummoned", eventCardUid: fusion!.uid }),
      ]),
    );
    expect(restored.host.messages).not.toContain("polymerization responder resolved");
  });

  it("uses a real Fusion substitute monster for one specifically listed material", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653";
    const goddessCode = "53493204";
    const missingMaterialCode = "2420";
    const materialBCode = "2421";
    const fusionCode = "2422";
    const responderCode = "2423";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === polymerizationCode || card.code === goddessCode),
      { code: materialBCode, name: "Substitute Fusion Material B Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1300, defense: 1000 },
      {
        code: fusionCode,
        name: "Substitute Polymerization Fusion Fixture",
        kind: "extra",
        typeFlags: 0x41,
        level: 6,
        attack: 2200,
        defense: 1800,
        fusionMaterials: [missingMaterialCode, materialBCode],
      },
      { code: responderCode, name: "Substitute Polymerization Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 242, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, goddessCode, materialBCode], extra: [fusionCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const goddess = session.state.cards.find((card) => card.code === goddessCode);
    const materialB = session.state.cards.find((card) => card.code === materialBCode);
    const fusion = session.state.cards.find((card) => card.code === fusionCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(goddess).toBeDefined();
    expect(materialB).toBeDefined();
    expect(fusion).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, polymerization!.uid, "hand", 0);
    moveDuelCard(session.state, goddess!.uid, "hand", 0);
    moveDuelCard(session.state, materialB!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(goddessCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === polymerization!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.cards.find((card) => card.uid === fusion!.uid)).toMatchObject({ location: "extraDeck" });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 1);
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
      summonMaterialUids: [goddess!.uid, materialB!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === goddess!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === materialB!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.host.messages).not.toContain("polymerization responder resolved");
  });

  it("honors Lua Fusion substitute value predicates against the Fusion target", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653";
    const substituteCode = "2440";
    const materialBCode = "2441";
    const heroFusionCode = "2442";
    const nonHeroFusionCode = "2443";
    const missingMaterialCode = "2444";
    const responderCode = "2445";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === polymerizationCode),
      { code: substituteCode, name: "Lua Predicate Fusion Substitute", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: materialBCode, name: "Lua Predicate Exact Material", kind: "monster", typeFlags: 0x1, level: 4, attack: 1300, defense: 1000 },
      {
        code: nonHeroFusionCode,
        name: "Lua Predicate Non-HERO Fusion",
        kind: "extra",
        typeFlags: 0x41,
        level: 6,
        attack: 2100,
        defense: 1800,
        fusionMaterials: [missingMaterialCode, materialBCode],
      },
      {
        code: heroFusionCode,
        name: "Lua Predicate HERO Fusion",
        kind: "extra",
        typeFlags: 0x41,
        level: 6,
        attack: 2200,
        defense: 1800,
        setcodes: [0x8],
        fusionMaterials: [missingMaterialCode, materialBCode],
      },
      { code: responderCode, name: "Lua Predicate Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 244, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, substituteCode, materialBCode], extra: [nonHeroFusionCode, heroFusionCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const substitute = session.state.cards.find((card) => card.code === substituteCode);
    const materialB = session.state.cards.find((card) => card.code === materialBCode);
    const heroFusion = session.state.cards.find((card) => card.code === heroFusionCode);
    const nonHeroFusion = session.state.cards.find((card) => card.code === nonHeroFusionCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(substitute).toBeDefined();
    expect(materialB).toBeDefined();
    expect(heroFusion).toBeDefined();
    expect(nonHeroFusion).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, polymerization!.uid, "hand", 0);
    moveDuelCard(session.state, substitute!.uid, "hand", 0);
    moveDuelCard(session.state, materialB!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${substituteCode}.lua`) return targetSpecificSubstituteScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(polymerizationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(substituteCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === polymerization!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 1);
    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === heroFusion!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "fusion",
      summonMaterialUids: [substitute!.uid, materialB!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === nonHeroFusion!.uid)).toMatchObject({ location: "extraDeck" });
  });

  it("does not allow two Fusion substitutes to replace both listed materials", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653";
    const goddessCode = "53493204";
    const missingMaterialACode = "2424";
    const missingMaterialBCode = "2425";
    const fusionCode = "2426";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === polymerizationCode || card.code === goddessCode),
      {
        code: fusionCode,
        name: "Double Substitute Polymerization Fusion Fixture",
        kind: "extra",
        typeFlags: 0x41,
        level: 6,
        attack: 2200,
        defense: 1800,
        fusionMaterials: [missingMaterialACode, missingMaterialBCode],
      },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 243, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, goddessCode, goddessCode], extra: [fusionCode] }, 1: { main: [] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const goddesses = session.state.cards.filter((card) => card.code === goddessCode);
    expect(polymerization).toBeDefined();
    expect(goddesses).toHaveLength(2);
    moveDuelCard(session.state, polymerization!.uid, "hand", 0);
    for (const goddess of goddesses) moveDuelCard(session.state, goddess.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(polymerizationCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(goddessCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    expect(getLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === polymerization!.uid)).toBe(false);
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
      e:SetOperation(function(e,tp) Debug.Message("polymerization responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function targetSpecificSubstituteScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_FUSION_SUBSTITUTE)
      e:SetValue(function(e,fc) return fc:IsSetCard(0x8) end)
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
