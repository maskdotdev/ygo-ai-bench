import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const heroSignalCode = "22020907";
const hasHeroSignalScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${heroSignalCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const setElementalHero = 0x3008;

describe.skipIf(!hasUpstreamScripts || !hasHeroSignalScript)("Lua real script Hero Signal battle-destroyed Trap summon", () => {
  it("restores Hero Signal's battle-destroyed Trap activation and Special Summons a low-level Elemental HERO", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const destroyedCode = "22020908";
    const heroTargetCode = "22020909";
    const offSetTargetCode = "22020910";
    const attackerCode = "22020911";
    const responderCode = "22020912";
    const script = workspace.readScript(`c${heroSignalCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYED)");
    expect(script).toContain("return c:IsReason(REASON_BATTLE) and c:IsLocation(LOCATION_GRAVE) and c:IsPreviousControler(tp)");
    expect(script).toContain("return c:IsLevelBelow(4) and c:IsSetCard(SET_ELEMENTAL_HERO) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND|LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND|LOCATION_DECK,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: heroSignalCode, name: "Hero Signal", kind: "trap", typeFlags: typeTrap },
      { code: destroyedCode, name: "Hero Signal Destroyed Ally", kind: "monster", typeFlags: typeMonster, level: 4, attack: 800, defense: 800 },
      {
        code: heroTargetCode,
        name: "Hero Signal Elemental HERO Target",
        kind: "monster",
        typeFlags: typeMonster,
        setcodes: [setElementalHero],
        level: 4,
        attack: 1000,
        defense: 1000,
      },
      {
        code: offSetTargetCode,
        name: "Hero Signal Off-Set Target",
        kind: "monster",
        typeFlags: typeMonster,
        setcodes: [0x123],
        level: 4,
        attack: 1000,
        defense: 1000,
      },
      { code: attackerCode, name: "Hero Signal Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Hero Signal Chain Responder", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 22020907, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [heroSignalCode, destroyedCode, offSetTargetCode, heroTargetCode] }, 1: { main: [attackerCode, responderCode] } });
    startDuel(session);

    const heroSignal = requireCard(session, heroSignalCode);
    const destroyedAlly = requireCard(session, destroyedCode);
    const heroTarget = requireCard(session, heroTargetCode);
    const offSetTarget = requireCard(session, offSetTargetCode);
    const attacker = requireCard(session, attackerCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, heroSignal.uid, "spellTrapZone", 0);
    heroSignal.position = "faceDown";
    heroSignal.faceUp = false;
    heroSignal.turnId = 0;
    moveDuelCard(session.state, destroyedAlly.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, attacker.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(heroSignalCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredInitial);
    expectRestoredLegalActions(restoredInitial, 1);
    const attack = getLuaRestoreLegalActions(restoredInitial, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === destroyedAlly.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredInitial, attack!);
    passUntilBattleDestroyedActivation(restoredInitial.session, heroSignal.uid);
    expect(restoredInitial.session.state.cards.find((card) => card.uid === destroyedAlly.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.battle | duelReason.destroy,
      reasonCardUid: attacker.uid,
    });
    expect(restoredInitial.session.state.eventHistory.filter((event) => event.eventName === "battleDestroyed")).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: destroyedAlly.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
      },
    ]);

    const restoredActivationWindow = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), source, reader);
    expectCleanRestore(restoredActivationWindow);
    expect(restoredActivationWindow.session.state.pendingTriggers).toEqual([]);
    expectRestoredLegalActions(restoredActivationWindow, 0);
    const signalAction = getLuaRestoreLegalActions(restoredActivationWindow, 0).find(
      (action) => action.type === "activateEffect" && action.uid === heroSignal.uid,
    );
    expect(signalAction, JSON.stringify(getLuaRestoreLegalActions(restoredActivationWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivationWindow, signalAction!);
    expect(restoredActivationWindow.session.state.chain).toEqual([
      {
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1-1140",
        eventCardUid: destroyedAlly.uid,
        eventCode: 1140,
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventName: "battleDestroyed",
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonCardUid: attacker.uid,
        eventReasonPlayer: 1,
        id: "chain-6",
        operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x3 }],
        player: 0,
        sourceUid: heroSignal.uid,
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivationWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === heroSignal.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === destroyedAlly.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offSetTarget.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === heroTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredChain.host.messages).not.toContain("hero signal responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: heroTarget.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: heroSignal.uid,
        eventReasonEffectId: 1,
        eventUids: [heroTarget.uid],
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function chainResponderScript(): string {
  return `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("hero signal responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passUntilBattleDestroyedActivation(session: DuelSession, signalUid: string): void {
  let guard = 0;
  while (!getLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === signalUid)) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const stateSummary = {
      player,
      phase: session.state.phase,
      battleStep: session.state.battleStep,
      battleWindow: session.state.battleWindow,
      pendingBattle: session.state.pendingBattle,
      currentAttack: session.state.currentAttack,
      lastEvent: session.state.eventHistory.at(-1),
      p0Actions: getLegalActions(session, 0),
      playerActions: getLegalActions(session, player),
    };
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType || action.type === "passChain");
    expect(pass, JSON.stringify(stateSummary, null, 2)).toBeDefined();
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
