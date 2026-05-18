import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Backfire to-Grave chain-info damage", () => {
  it("restores its EVENT_TO_GRAVE trigger and resolves target-player target-param damage from CHAININFO", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const backfireCode = "82705573";
    const fireTargetCode = "82705574";
    const destroyerCode = "82705575";
    const responderCode = "82705576";
    const script = workspace.readScript(`c${backfireCode}.lua`);
    expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
    expect(script).toContain("Duel.SetTargetParam(500)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === backfireCode),
      {
        code: fireTargetCode,
        name: "Backfire FIRE Target",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        attribute: attributeFire,
        level: 4,
        attack: 1000,
        defense: 1000,
      },
      { code: destroyerCode, name: "Backfire Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
      { code: responderCode, name: "Backfire Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8270, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [backfireCode, fireTargetCode, destroyerCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const backfire = requireCard(session, backfireCode);
    const fireTarget = requireCard(session, fireTargetCode);
    const destroyer = requireCard(session, destroyerCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, backfire.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, fireTarget.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, destroyer.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = realBackfireWithLocalSupport(workspace, fireTargetCode, destroyerCode, responderCode);
    const host = createLuaScriptHost(session, workspace);
    for (const code of [backfireCode, destroyerCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const destroyAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroyAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, destroyAction!);
    resolveEngineChain(session);
    expect(session.state.cards.find((card) => card.uid === fireTarget.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: destroyer.uid,
    });
    expect(session.state.pendingTriggers).toMatchObject([
      {
        player: 0,
        sourceUid: backfire.uid,
        effectId: "lua-2-1014",
        triggerBucket: "turnMandatory",
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: fireTarget.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 3,
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === backfire.uid,
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain[0]).toEqual({
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-2-1014",
      eventCardUid: fireTarget.uid,
      eventCode: 1014,
      eventCurrentState: {
        controller: 0,
        faceUp: true,
        location: "graveyard",
        position: "faceUpAttack",
        sequence: 0,
      },
      eventName: "sentToGraveyard",
      eventPreviousState: {
        controller: 0,
        faceUp: true,
        location: "monsterZone",
        position: "faceUpAttack",
        sequence: 0,
      },
      eventReason: duelReason.effect | duelReason.destroy,
      eventReasonCardUid: destroyer.uid,
      eventReasonEffectId: 3,
      eventReasonPlayer: 0,
      eventTriggerTiming: "when",
      id: "chain-5",
      operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 500 }],
      player: 0,
      sourceUid: backfire.uid,
      targetParam: 500,
      targetPlayer: 1,
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: backfire.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restoredChain.host.messages).not.toContain("backfire responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function realBackfireWithLocalSupport(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  fireTargetCode: string,
  destroyerCode: string,
  responderCode: string,
) {
  return {
    readScript(name: string) {
      if (name === `c${destroyerCode}.lua`) return destroyerScript(fireTargetCode);
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      return workspace.readScript(name);
    },
  };
}

function destroyerScript(fireTargetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fireTargetCode}),tp,LOCATION_MZONE,0,nil)
        Duel.Destroy(tc,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
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
      e:SetOperation(function(e,tp) Debug.Message("backfire responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveEngineChain(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
