import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, createDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const infernalqueenCode = "8581705";
const hasInfernalqueenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${infernalqueenCode}.lua`));
const responderCode = "85817050";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setArchfiend = 0x45;

describe.skipIf(!hasUpstreamScripts || !hasInfernalqueenScript)("Lua real script Infernalqueen Archfiend standby cost stat", () => {
  it("restores mandatory Standby LP upkeep into targeted Archfiend ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${infernalqueenCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(script).toContain("Duel.CheckLPCost(tp,500)");
    expect(script).toContain("Duel.PayLPCost(tp,500)");
    expect(script).toContain("Duel.Destroy(e:GetHandler(),REASON_COST)");
    expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVING)");
    expect(script).toContain("Duel.TossDice(tp,1)");
    expect(script).toContain("Duel.NegateEffect(ev)");
    expect(script).toContain("e3:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1000)");

    const cards: DuelCardData[] = [
      { code: infernalqueenCode, name: "Infernalqueen Archfiend", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setArchfiend], level: 4, attack: 900, defense: 1500 },
      { code: responderCode, name: "Infernalqueen Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8581705, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [infernalqueenCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const queen = requireCard(session, infernalqueenCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, queen.uid, "monsterZone", 0);
    queen.faceUp = true;
    queen.position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "draw";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(infernalqueenCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 0);
    const standby = getLuaRestoreLegalActions(restoredDraw, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDraw, standby!);
    expect(restoredDraw.session.state.phase).toBe("standby");
    expect(restoredDraw.session.state.players[0].lifePoints).toBe(7500);
    expect(restoredDraw.session.state.cards.find((card) => card.uid === queen.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredDraw.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-3-4098",
        sourceUid: queen.uid,
        eventName: "phaseStandby",
        eventCode: 0x1002,
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);
    expect(restoredDraw.session.state.eventHistory.filter((event) => ["phaseStandby", "lifePointCostPaid"].includes(event.eventName)).sort((a, b) => a.eventName.localeCompare(b.eventName))).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: queen.uid,
        eventReasonEffectId: 1,
      },
      { eventName: "phaseStandby", eventCode: 0x1002 },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === queen.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toHaveLength(1);
    expect(restoredTrigger.session.state.chain[0]!.operationInfos).toEqual([
      { category: 0x200000, targetUids: [queen.uid], count: 1, player: 0, parameter: 1000 },
    ]);
    expectRestoredLegalActions(restoredTrigger, 1);
    expect(getLuaRestoreLegalActions(restoredTrigger, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredTrigger);
    expect(restoredTrigger.host.messages).not.toContain("infernalqueen responder resolved");
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === queen.uid), restoredTrigger.session.state)).toBe(1900);
    expect(restoredTrigger.session.state.effects
      .filter((effect) => effect.sourceUid === queen.uid && effect.event === "continuous" && effect.code === 100)
      .map((effect) => ({ code: effect.code, controller: effect.controller, range: effect.range, value: effect.value }))).toEqual([
      { code: 100, controller: 0, range: ["monsterZone"], value: 1000 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-5",
        eventCardUid: queen.uid,
      },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === queen.uid), restoredStat.session.state)).toBe(1900);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
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
      e:SetOperation(function(e,tp) Debug.Message("infernalqueen responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse | DuelAction): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
}
