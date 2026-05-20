import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const orbital7Code = "71071546";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasOrbital7Script = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${orbital7Code}.lua`));
const bossCounter = 0x2c;
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasOrbital7Script)("Lua real script Orbital 7 counter final ATK End Phase send", () => {
  it("restores flip counter placement into all-counter cost, final ATK, direct-attack lock, and End Phase self-send", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const responderCode = "71071547";
    const script = workspace.readScript(`c${orbital7Code}.lua`);
    expect(script).toContain("c:EnableCounterPermit(COUNTER_YOU_GOT_IT_BOSS)");
    expect(script).toContain("e1:SetCode(EVENT_FLIP)");
    expect(script).toContain("c:AddCounter(COUNTER_YOU_GOT_IT_BOSS,1)");
    expect(script).toContain("e:GetHandler():RemoveCounter(tp,COUNTER_YOU_GOT_IT_BOSS,ct,REASON_COST)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(2000)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");
    expect(script).toContain("e3:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("Duel.SendtoGrave(e:GetHandler(),REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === orbital7Code),
      { code: responderCode, name: "Orbital 7 Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 71071546, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [orbital7Code] }, 1: { main: [responderCode] } });
    startDuel(session);

    const orbital = requireCard(session, orbital7Code);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, orbital.uid, "monsterZone", 0);
    orbital.position = "faceDownDefense";
    orbital.faceUp = false;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(orbital7Code), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenWindow);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const flip = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((action) => action.type === "flipSummon" && action.uid === orbital.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpenWindow, flip!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1001",
        sourceUid: orbital.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: orbital.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === orbital.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredTrigger, trigger!);

    const restoredCounterChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredCounterChain);
    expectRestoredLegalActions(restoredCounterChain, 1);
    resolveRestoredChain(restoredCounterChain);
    expect(restoredCounterChain.session.state.cards.find((card) => card.uid === orbital.uid)).toMatchObject({
      counters: { [bossCounter]: 1 },
      faceUp: true,
      location: "monsterZone",
    });

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredCounterChain.session), source, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === orbital.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredIgnition, ignition!);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === orbital.uid)?.counters?.[bossCounter] ?? 0).toBe(0);

    const restoredAttackChain = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), source, reader);
    expectCleanRestore(restoredAttackChain);
    expectRestoredLegalActions(restoredAttackChain, 1);
    expect(getLuaRestoreLegalActions(restoredAttackChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredAttackChain);
    expect(restoredAttackChain.host.messages).not.toContain("orbital responder resolved");
    const restoredOrbital = restoredAttackChain.session.state.cards.find((card) => card.uid === orbital.uid);
    expect(currentAttack(restoredOrbital, restoredAttackChain.session.state)).toBe(2000);
    expect(restoredAttackChain.session.state.effects.filter((effect) => effect.sourceUid === orbital.uid && effect.code === 73)).toEqual([
      expect.objectContaining({
        code: 73,
        event: "continuous",
        sourceUid: orbital.uid,
      }),
    ]);
    expect(restoredAttackChain.session.state.effects.filter((effect) => effect.sourceUid === orbital.uid && effect.triggerEvent === "phaseEnd")).toEqual([
      expect.objectContaining({
        code: 0x1200,
        countLimit: 1,
        registryKey: `lua:${orbital7Code}:lua-8-4608`,
        reset: { flags: 0xc6e1000 },
        triggerCode: 0x1200,
        triggerEvent: "phaseEnd",
      }),
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredAttackChain.session), source, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    expect(getLuaRestoreLegalActions(restoredBattle, 0).some((action) => action.type === "declareAttack" && action.attackerUid === orbital.uid && action.targetUid === undefined)).toBe(false);

    const restoredEndPhase = restoreDuelWithLuaScripts(serializeDuel(restoredAttackChain.session), source, reader);
    expectCleanRestore(restoredEndPhase);
    expectRestoredLegalActions(restoredEndPhase, 0);
    restoredEndPhase.session.state.phase = "main2";
    restoredEndPhase.session.state.waitingFor = 0;
    const endPhase = getLuaRestoreLegalActions(restoredEndPhase, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredEndPhase, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredEndPhase, endPhase!);
    expect(restoredEndPhase.session.state.pendingTriggers).toEqual([]);
    expect(restoredEndPhase.session.state.cards.find((card) => card.uid === orbital.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: orbital.uid,
      reasonEffectId: 8,
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
      e:SetOperation(function(e,tp) Debug.Message("orbital responder resolved") end)
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAction(restored, pass!);
  }
}
