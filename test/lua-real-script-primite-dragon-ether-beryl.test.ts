import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Primite Dragon Ether Beryl", () => {
  it("restores its summon trigger and Sets a Primite Spell/Trap from Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const etherBerylCode = "63198739";
    const lordlyLodeCode = "56506740";
    const responderCode = "63190000";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [etherBerylCode, lordlyLodeCode].includes(card.code)),
      { code: responderCode, name: "Ether Beryl Chain Responder", kind: "monster", typeFlags: 0x21, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 631, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [etherBerylCode, lordlyLodeCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const etherBeryl = session.state.cards.find((card) => card.code === etherBerylCode);
    const lordlyLode = session.state.cards.find((card) => card.code === lordlyLodeCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(etherBeryl).toBeDefined();
    expect(lordlyLode).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, etherBeryl!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        return name === `c${responderCode}.lua` ? chainResponderScript() : workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(etherBerylCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThanOrEqual(2);

    const summon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === etherBeryl!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    expect(session.state.cards.find((card) => card.uid === etherBeryl!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });

    const trigger = getLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.uid === etherBeryl!.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(session.state.chain).toEqual([
      expect.objectContaining({
        sourceUid: etherBeryl!.uid,
        eventName: "normalSummoned",
        eventCardUid: etherBeryl!.uid,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === lordlyLode!.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: false,
      position: "faceDown",
    });
    expect(restored.session.state.cards.find((card) => card.uid === etherBeryl!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
  });

  it("restores its self-Tribute ignition effect and sends a Normal Monster from Deck to the GY", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const etherBerylCode = "63198739";
    const darkMagicianCode = "46986414";
    const responderCode = "63190001";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [etherBerylCode, darkMagicianCode].includes(card.code)),
      { code: responderCode, name: "Ether Beryl Ignition Responder", kind: "monster", typeFlags: 0x21, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 632, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [etherBerylCode, darkMagicianCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const etherBeryl = session.state.cards.find((card) => card.code === etherBerylCode);
    const darkMagician = session.state.cards.find((card) => card.code === darkMagicianCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(etherBeryl).toBeDefined();
    expect(darkMagician).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, etherBeryl!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        return name === `c${responderCode}.lua` ? chainResponderScript() : workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(etherBerylCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThanOrEqual(2);

    const ignition = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === etherBeryl!.uid);
    expect(ignition).toBeDefined();
    applyAndAssert(session, ignition!);
    expect(session.state.cards.find((card) => card.uid === etherBeryl!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.chain).toEqual([
      expect.objectContaining({
        sourceUid: etherBeryl!.uid,
        operationInfos: [{ category: 0x20, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === darkMagician!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
    });
    expect(restored.session.state.cards.find((card) => card.uid === etherBeryl!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
    });
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
      e:SetOperation(function(e,tp) Debug.Message("ether beryl responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  for (let index = 0; index < 8 && restored.session.state.chain.length > 0; index += 1) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const response = applyLuaRestoreResponse(restored, pass!);
    expect(response.ok, response.error).toBe(true);
  }
  expect(restored.session.state.chain).toHaveLength(0);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
