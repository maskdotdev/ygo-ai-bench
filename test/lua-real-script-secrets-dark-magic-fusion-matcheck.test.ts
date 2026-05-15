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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Secrets of Dark Magic Fusion material check", () => {
  it("restores the Fusion material check that requires Dark Magician or Dark Magician Girl", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const secretsCode = "59514116";
    const darkMagicianCode = "46986414";
    const materialCode = "59514117";
    const fusionCode = "59514118";
    const responderCode = "59514119";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === secretsCode),
      { code: darkMagicianCode, name: "Dark Magician", kind: "monster", typeFlags: 0x11, race: 0x10, attribute: 0x10, level: 7, attack: 2500, defense: 2100 },
      { code: materialCode, name: "Secrets Fusion Material Fixture", kind: "monster", typeFlags: 0x21, race: 0x10, attribute: 0x10, level: 4, attack: 1200, defense: 1000 },
      {
        code: fusionCode,
        name: "Secrets of Dark Magic Fusion Fixture",
        kind: "extra",
        typeFlags: 0x41,
        race: 0x10,
        attribute: 0x10,
        level: 8,
        attack: 2800,
        defense: 2300,
        fusionMaterials: [darkMagicianCode, materialCode],
      },
      { code: responderCode, name: "Secrets Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 595, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [secretsCode, darkMagicianCode, materialCode], extra: [fusionCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const secrets = session.state.cards.find((card) => card.code === secretsCode);
    const darkMagician = session.state.cards.find((card) => card.code === darkMagicianCode);
    const material = session.state.cards.find((card) => card.code === materialCode);
    const fusion = session.state.cards.find((card) => card.code === fusionCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(secrets).toBeDefined();
    expect(darkMagician).toBeDefined();
    expect(material).toBeDefined();
    expect(fusion).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, secrets!.uid, "hand", 0);
    moveDuelCard(session.state, darkMagician!.uid, "hand", 0);
    moveDuelCard(session.state, material!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(secretsCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === secrets!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]!.operationInfos).toEqual(
      expect.arrayContaining([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
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
      summonMaterialUids: [darkMagician!.uid, material!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === darkMagician!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === secrets!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.host.messages).not.toContain("secrets responder resolved");
  });

  it("does not expose the Fusion activation when no selected material is Dark Magician or Dark Magician Girl", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const secretsCode = "59514116";
    const materialACode = "59514120";
    const materialBCode = "59514121";
    const fusionCode = "59514122";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === secretsCode),
      { code: materialACode, name: "Secrets Non-Dark Magician Material A", kind: "monster", typeFlags: 0x21, level: 4, attack: 1200, defense: 1000 },
      { code: materialBCode, name: "Secrets Non-Dark Magician Material B", kind: "monster", typeFlags: 0x21, level: 4, attack: 1300, defense: 1000 },
      {
        code: fusionCode,
        name: "Secrets No Dark Magician Fusion Fixture",
        kind: "extra",
        typeFlags: 0x41,
        level: 8,
        attack: 2800,
        defense: 2300,
        fusionMaterials: [materialACode, materialBCode],
      },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 596, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [secretsCode, materialACode, materialBCode], extra: [fusionCode] }, 1: { main: [] } });
    startDuel(session);

    const secrets = session.state.cards.find((card) => card.code === secretsCode);
    const materialA = session.state.cards.find((card) => card.code === materialACode);
    const materialB = session.state.cards.find((card) => card.code === materialBCode);
    expect(secrets).toBeDefined();
    expect(materialA).toBeDefined();
    expect(materialB).toBeDefined();
    moveDuelCard(session.state, secrets!.uid, "hand", 0);
    moveDuelCard(session.state, materialA!.uid, "hand", 0);
    moveDuelCard(session.state, materialB!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(secretsCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === secrets!.uid)).toBeUndefined();
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
      e:SetOperation(function(e,tp) Debug.Message("secrets responder resolved") end)
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
