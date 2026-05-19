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
const darkRoomCode = "85562745";
const burnStarterCode = "85562746";
const responderCode = "85562747";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dark Room of Nightmare event damage", () => {
  it("restores its EVENT_DAMAGE trigger and resolves target-player target-param damage from CHAININFO", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${darkRoomCode}.lua`);
    expect(script).toContain("e2:SetCode(EVENT_DAMAGE)");
    expect(script).toContain("return ep~=tp and (r&REASON_BATTLE)==0 and re and re:GetHandler():GetCode()~=id");
    expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
    expect(script).toContain("Duel.SetTargetParam(300)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === darkRoomCode),
      { code: burnStarterCode, name: "Dark Room Burn Starter", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
      { code: responderCode, name: "Dark Room Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 85562745, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darkRoomCode, burnStarterCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const darkRoom = requireCard(session, darkRoomCode);
    const burnStarter = requireCard(session, burnStarterCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, darkRoom.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, burnStarter.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${burnStarterCode}.lua`) return burnStarterScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [darkRoomCode, burnStarterCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const burnAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === burnStarter.uid);
    expect(burnAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, burnAction!);
    resolveEngineChain(session);
    expect(session.state.players[1].lifePoints).toBe(6800);
    expect(host.messages).toContain("dark room burn applied 1200");
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-2-1111",
        sourceUid: darkRoom.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1200,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: burnStarter.uid,
        eventReasonEffectId: 3,
        eventTriggerTiming: "when",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === darkRoom.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-2-1111",
        eventCode: 1111,
        eventName: "damageDealt",
        eventPlayer: 1,
        eventReason: duelReason.effect,
        eventReasonCardUid: burnStarter.uid,
        eventReasonEffectId: 3,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventValue: 1200,
        id: "chain-5",
        operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 300 }],
        player: 0,
        sourceUid: darkRoom.uid,
        targetParam: 300,
        targetPlayer: 1,
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredChain.session.state.players[1].lifePoints).toBe(6500);
    expect(restoredChain.session.state.pendingTriggers).toEqual([]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1200,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: burnStarter.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 300,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkRoom.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restoredChain.host.messages).not.toContain("dark room responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function burnStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        Debug.Message("dark room burn applied " .. Duel.Damage(1-tp,1200,REASON_EFFECT))
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
      e:SetOperation(function(e,tp) Debug.Message("dark room responder resolved") end)
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const raw = getLuaRestoreLegalActions(restored, player);
  const grouped = getLuaRestoreLegalActionGroups(restored, player);
  expect(grouped.flatMap((group) => group.actions)).toEqual(raw);
  expect(result.legalActions).toEqual(raw);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const result = applyResponse(session, action);
  expect(result.ok, result.error).toBe(true);
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const raw = getLegalActions(session, player);
  const grouped = getGroupedDuelLegalActions(session, player);
  expect(grouped.flatMap((group) => group.actions)).toEqual(raw);
  expect(result.legalActions).toEqual(raw);
}

function resolveEngineChain(session: DuelSession): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
