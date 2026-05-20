import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const capacitorCode = "29716911";
const cyberseCode = "297169110";
const nonCyberseCode = "297169111";
const responderCode = "297169112";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCapacitorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${capacitorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasCapacitorScript)("Lua real script Capacitor Stalker target boost destroy damage", () => {
  it("restores summon target relation ATK boost and effect-destroyed both-player damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${capacitorCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsRace,RACE_CYBERSE),tp,LOCATION_MZONE,0,1,1,c)");
    expect(script).toContain("c:SetCardTarget(tc)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetTarget(function(e,_c) return c:IsHasCardTarget(_c) end)");
    expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("return c:IsReason(REASON_EFFECT) and c:IsLocation(LOCATION_GRAVE) and c:IsPreviousLocation(LOCATION_MZONE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,PLAYER_ALL,800)");
    expect(script).toContain("Duel.Damage(tp,800,REASON_EFFECT,true)");
    expect(script).toContain("Duel.Damage(1-tp,800,REASON_EFFECT,true)");
    expect(script).toContain("Duel.RDComplete()");

    const cards: DuelCardData[] = [
      { code: capacitorCode, name: "Capacitor Stalker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, level: 4, attack: 2000, defense: 1000 },
      { code: cyberseCode, name: "Capacitor Cyberse Boost Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, level: 4, attack: 1000, defense: 1000 },
      { code: nonCyberseCode, name: "Capacitor Non-Cyberse Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1600, defense: 1000 },
      { code: responderCode, name: "Capacitor Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 29716911, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [capacitorCode, cyberseCode, nonCyberseCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const capacitor = requireCard(session, capacitorCode);
    const cyberse = requireCard(session, cyberseCode);
    const nonCyberse = requireCard(session, nonCyberseCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, capacitor.uid, "hand", 0);
    moveFaceUpAttack(session, cyberse, 0);
    moveFaceUpAttack(session, nonCyberse, 0);
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
    expect(host.loadCardScript(Number(capacitorCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === capacitor.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredSummon, summon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1100",
        sourceUid: capacitor.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: capacitor.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === capacitor.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-1-1100",
        sourceUid: capacitor.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 2,
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: capacitor.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
        targetUids: [cyberse.uid],
      },
    ]);

    const restoredBoostChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredBoostChain);
    expectRestoredLegalActions(restoredBoostChain, 1);
    expect(getLuaRestoreLegalActions(restoredBoostChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredBoostChain);

    expect(restoredBoostChain.host.messages).not.toContain("capacitor responder resolved");
    expect(currentAttack(restoredBoostChain.session.state.cards.find((card) => card.uid === cyberse.uid), restoredBoostChain.session.state)).toBe(1800);
    expect(currentAttack(restoredBoostChain.session.state.cards.find((card) => card.uid === nonCyberse.uid), restoredBoostChain.session.state)).toBe(1600);
    expect(restoredBoostChain.session.state.effects.filter((effect) => effect.sourceUid === capacitor.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", property: 0x400, range: ["monsterZone"], targetRange: [4, 0], value: 800 },
    ]);

    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredBoostChain.session), source, reader);
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    const destroyed = destroyDuelCard(restoredDestroyed.session.state, capacitor.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(destroyed).toMatchObject({ location: "graveyard", controller: 0, previousLocation: "monsterZone" });
    expect(currentAttack(restoredDestroyed.session.state.cards.find((card) => card.uid === cyberse.uid), restoredDestroyed.session.state)).toBe(1000);
    expect(restoredDestroyed.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        effectId: "lua-2-1029",
        sourceUid: capacitor.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: capacitor.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredDamageTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyed.session), source, reader);
    expectCleanRestore(restoredDamageTrigger);
    expectRestoredLegalActions(restoredDamageTrigger, 0);
    const damageTrigger = getLuaRestoreLegalActions(restoredDamageTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === capacitor.uid);
    expect(damageTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDamageTrigger, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredDamageTrigger, damageTrigger!);
    expect(restoredDamageTrigger.session.state.chain).toEqual([
      {
        id: "chain-6",
        chainIndex: 1,
        effectId: "lua-2-1029",
        sourceUid: capacitor.uid,
        player: 0,
        activationLocation: "graveyard",
        activationSequence: 0,
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: capacitor.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 0, parameter: 800 }],
      },
    ]);

    const restoredDamageChain = restoreDuelWithLuaScripts(serializeDuel(restoredDamageTrigger.session), source, reader);
    expectCleanRestore(restoredDamageChain);
    expectRestoredLegalActions(restoredDamageChain, 1);
    passRestoredChain(restoredDamageChain);
    expect(restoredDamageChain.session.state.players[0].lifePoints).toBe(7200);
    expect(restoredDamageChain.session.state.players[1].lifePoints).toBe(7200);
    expect(restoredDamageChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: capacitor.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: capacitor.uid,
        eventReasonEffectId: 2,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", controller);
  card.position = "faceUpAttack";
  card.faceUp = true;
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
      e:SetOperation(function(e,tp) Debug.Message("capacitor responder resolved") end)
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAction(restored, pass!);
  }
}
