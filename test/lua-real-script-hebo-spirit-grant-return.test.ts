import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardTypeFlags } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
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
const effectAddType = 115;
const phaseEndEvent = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Hebo Spirit grant return", () => {
  it("restores target-granted Spirit type and the target-owned End Phase return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const heboCode = "90365482";
    const targetCode = "90365483";
    const responderCode = "90365484";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === heboCode),
      { code: targetCode, name: "Hebo Granted Spirit Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1400, defense: 1200 },
      { code: responderCode, name: "Hebo Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 903, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [heboCode, targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const hebo = session.state.cards.find((card) => card.code === heboCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(hebo).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, hebo!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    target!.faceUp = true;
    target!.position = "faceUpAttack";
    target!.sequence = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${targetCode}.lua`) return emptyCardScript(targetCode);
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(heboCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === hebo!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === hebo!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toHaveLength(1);
    expect(restoredTriggerWindow.session.state.chain[0]).toMatchObject({
      sourceUid: hebo!.uid,
      targetUids: [target!.uid],
    });

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredChainWindow.restoreComplete, restoredChainWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChainWindow.missingRegistryKeys).toEqual([]);
    expect(restoredChainWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChainWindow, 1);
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChainWindow, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChainWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(cardTypeFlags(restoredChainWindow.session.state.cards.find((card) => card.uid === target!.uid), restoredChainWindow.session.state) & typeSpirit).toBe(typeSpirit);

    const restoredGrantedState = restoreDuelWithLuaScripts(serializeDuel(restoredChainWindow.session), source, reader);
    expect(restoredGrantedState.restoreComplete, restoredGrantedState.incompleteReasons.join("; ")).toBe(true);
    expect(restoredGrantedState.missingRegistryKeys).toEqual([]);
    expect(restoredGrantedState.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredGrantedState, 0);
    expect(restoredGrantedState.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: target!.uid, event: "continuous", code: effectAddType, value: typeSpirit }),
        expect.objectContaining({ sourceUid: target!.uid, event: "continuous", code: phaseEndEvent, countLimit: 1 }),
      ]),
    );
    expect(cardTypeFlags(restoredGrantedState.session.state.cards.find((card) => card.uid === target!.uid), restoredGrantedState.session.state) & typeSpirit).toBe(typeSpirit);

    for (const phase of ["battle", "main2", "end"] as const) {
      applyActionAndAssert(
        restoredGrantedState.session,
        getDuelLegalActions(restoredGrantedState.session, 0).find((action) => action.type === "changePhase" && action.phase === phase),
      );
    }

    expect(restoredGrantedState.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredGrantedState.session.state.cards.find((card) => card.uid === hebo!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredGrantedState.session.state.eventHistory.filter((event) => event.eventName === "sentToHand" && event.eventCardUid === target!.uid)).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: target!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: target!.uid,
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
    expect(restoredGrantedState.host.messages).not.toContain("hebo responder resolved");
  });
});

function emptyCardScript(code: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
    end
  `;
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
      e:SetOperation(function(e,tp) Debug.Message("hebo responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function applyActionAndAssert(session: DuelSession, action: DuelAction | undefined): void {
  expect(action, JSON.stringify(getDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer), null, 2)).toBeDefined();
  const result = applyResponse(session, action!);
  expect(result.ok, result.error).toBe(true);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
