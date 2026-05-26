import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const borrelswordCode = "85289965";
const positionTargetCode = "852899650";
const battleTargetCode = "852899651";
const responderCode = "852899652";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBorrelswordScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${borrelswordCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasBorrelswordScript)("Lua real script Borrelsword position extra attack stat", () => {
  it("restores target position chain-limit, extra attack grant, and attack-announcement ATK steal", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${borrelswordCode}.lua`);
    expectBorrelswordScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 85289965, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [borrelswordCode] }, 1: { main: [positionTargetCode, battleTargetCode, responderCode] } });
    startDuel(session);

    const borrelsword = requireCard(session, borrelswordCode);
    const positionTarget = requireCard(session, positionTargetCode);
    const battleTarget = requireCard(session, battleTargetCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, borrelsword, 0, 0);
    moveFaceUpAttack(session, positionTarget, 1, 0);
    moveFaceUpAttack(session, battleTarget, 1, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return responderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(borrelswordCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.filter((effect) => effect.sourceUid === borrelsword.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
      { category: undefined, code: 42, event: "continuous", property: 131072, range: ["monsterZone"], triggerEvent: undefined, value: 1 },
      { category: 0x1000, code: 1002, event: "quick", property: 0x10, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
      { category: 0x200000, code: 1130, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "attackDeclared", value: undefined },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const quickPosition = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === borrelsword.uid);
    expect(quickPosition, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, quickPosition!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.chainLimits).toEqual([]);
    expect(restoredOpen.host.messages).not.toContain("borrelsword responder resolved");

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    expect(getLuaRestoreLegalActions(restoredResponse, 1)).toEqual([]);
    expect(restoredResponse.session.state.cards.find((card) => card.uid === positionTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      position: "faceUpDefense",
    });
    expect(restoredResponse.session.state.effects.filter((effect) => effect.sourceUid === borrelsword.uid && effect.code === 194).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 194, property: 0x400, reset: { flags: 1107169792 }, value: 1 }]);
    expect(restoredResponse.session.state.chainLimits).toEqual([]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), source, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === borrelsword.uid && action.targetUid === battleTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-4-1130",
        eventCardUid: borrelsword.uid,
        eventName: "attackDeclared",
        eventPlayer: 0,
        eventReason: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: borrelsword.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === borrelsword.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-6",
        chainIndex: 1,
        effectId: "lua-4-1130",
        sourceUid: borrelsword.uid,
        player: 0,
        eventName: "attackDeclared",
        eventCode: 1130,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventCardUid: borrelsword.uid,
        eventUids: [borrelsword.uid, battleTarget.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        activationLocation: "monsterZone",
        activationSequence: 0,
      },
    ]);
    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 1);
    resolveRestoredChain(restoredStat);

    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === borrelsword.uid), restoredStat.session.state)).toBe(4251);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === battleTarget.uid), restoredStat.session.state)).toBe(1251);
    expect(restoredStat.session.state.effects.filter((effect) => [borrelsword.uid, battleTarget.uid].includes(effect.sourceUid) && (effect.code === 100 || effect.code === 102)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x400, reset: { flags: 1107169792 }, sourceUid: borrelsword.uid, value: 1251 },
      { code: 102, property: undefined, reset: { flags: 1107169792 }, sourceUid: battleTarget.uid, value: 1251 },
    ]);
    expect(restoredStat.session.state.eventHistory.filter((event) => ["becameTarget", "positionChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: positionTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: positionTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: borrelsword.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: borrelswordCode, name: "Borrelsword Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceDragon, attribute: attributeDark, level: 4, attack: 3000, defense: 0, linkMarkers: 0x5b },
    { code: positionTargetCode, name: "Borrelsword Position Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
    { code: battleTargetCode, name: "Borrelsword Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2501, defense: 1500 },
    { code: responderCode, name: "Borrelsword Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectBorrelswordScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsType,TYPE_EFFECT),3)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCategory(CATEGORY_POSITION)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("Duel.SelectTarget(tp,s.posfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetChainLimit(s.chlimit)");
  expect(script).toContain("return tp==ep");
  expect(script).toContain("Duel.ChangePosition(tc,POS_FACEUP_DEFENSE,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("e2:SetCode(EFFECT_EXTRA_ATTACK)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e3:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e:GetHandler():GetBattleTarget():CreateEffectRelation(e)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetValue(math.ceil(atk/2))");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(math.ceil(atk/2))");
}

function responderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("borrelsword responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = (restored.session.state.waitingFor ?? restored.session.state.turnPlayer) as PlayerId;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
