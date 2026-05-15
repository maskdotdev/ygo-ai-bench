import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpirit = 0x200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Shinobird Pigeon Spirit return", () => {
  it("restores its field ignition target and returns another Spirit monster to the hand", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const pigeonCode = "92200612";
    const targetSpiritCode = "92200613";
    const invalidMonsterCode = "92200614";
    const responderCode = "92200615";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pigeonCode),
      { code: targetSpiritCode, name: "Shinobird Pigeon Return Spirit", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpirit, level: 4, attack: 1000, defense: 1000 },
      { code: invalidMonsterCode, name: "Shinobird Pigeon Non-Spirit", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Shinobird Pigeon Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 922, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [pigeonCode, targetSpiritCode] }, 1: { main: [invalidMonsterCode, responderCode] } });
    startDuel(session);

    const pigeon = session.state.cards.find((card) => card.code === pigeonCode);
    const targetSpirit = session.state.cards.find((card) => card.code === targetSpiritCode);
    const invalidMonster = session.state.cards.find((card) => card.code === invalidMonsterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(pigeon).toBeDefined();
    expect(targetSpirit).toBeDefined();
    expect(invalidMonster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, pigeon!.uid, "hand", 0);
    moveDuelCard(session.state, targetSpirit!.uid, "monsterZone", 0);
    targetSpirit!.position = "faceUpAttack";
    targetSpirit!.faceUp = true;
    moveDuelCard(session.state, invalidMonster!.uid, "monsterZone", 1);
    invalidMonster!.position = "faceUpAttack";
    invalidMonster!.faceUp = true;
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
    expect(host.loadCardScript(Number(pigeonCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === pigeon!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredIgnitionWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredIgnitionWindow.restoreComplete, restoredIgnitionWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredIgnitionWindow.missingRegistryKeys).toEqual([]);
    expect(restoredIgnitionWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredIgnitionWindow, 0);
    expect(getLuaRestoreLegalActions(restoredIgnitionWindow, 0)).toEqual(getDuelLegalActions(restoredIgnitionWindow.session, 0));
    const activation = getLuaRestoreLegalActions(restoredIgnitionWindow, 0).find((action) => action.type === "activateEffect" && action.uid === pigeon!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredIgnitionWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnitionWindow, activation!);
    expect(restoredIgnitionWindow.session.state.chain).toHaveLength(1);
    expect(restoredIgnitionWindow.session.state.chain[0]).toMatchObject({
      sourceUid: pigeon!.uid,
      targetUids: [targetSpirit!.uid],
      operationInfos: [{ category: 0x8, targetUids: [targetSpirit!.uid], count: 1, player: 0, parameter: 0 }],
    });
    expect(restoredIgnitionWindow.session.state.chain[0]?.targetUids).not.toContain(pigeon!.uid);
    expect(restoredIgnitionWindow.session.state.chain[0]?.targetUids).not.toContain(invalidMonster!.uid);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredIgnitionWindow.session), source, reader);
    expect(restoredChainWindow.restoreComplete, restoredChainWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChainWindow.missingRegistryKeys).toEqual([]);
    expect(restoredChainWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChainWindow, 1);
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChainWindow, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChainWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === targetSpirit!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === pigeon!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === invalidMonster!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "sentToHand" && event.eventCardUid === targetSpirit!.uid)).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: targetSpirit!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pigeon!.uid,
        eventReasonEffectId: 7,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredChainWindow.host.messages).not.toContain("shinobird pigeon responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("shinobird pigeon responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
