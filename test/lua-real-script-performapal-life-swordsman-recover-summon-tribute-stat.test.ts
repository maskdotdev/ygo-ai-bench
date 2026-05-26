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
const lifeSwordsmanCode = "7268133";
const recoverSourceCode = "72681330";
const allyCode = "72681331";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLifeSwordsmanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lifeSwordsmanCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeEarth = 0x1;
const effectSetAttackFinal = 102;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasLifeSwordsmanScript)("Lua real script Performapal Life Swordsman recover summon tribute stat", () => {
  it("restores opponent recovery hand SpecialSummonStep final ATK and SelfTribute target ATK update", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lifeSwordsmanCode}.lua`);
    expectLifeSwordsmanScriptShape(script);
    const reader = createCardReader(cards());

    const restoredRecover = createRestoredRecoverOpen({ reader, workspace });
    expectCleanRestore(restoredRecover);
    expectRestoredLegalActions(restoredRecover, 1);
    const recoverSource = requireCard(restoredRecover.session, recoverSourceCode);
    const recover = getLuaRestoreLegalActions(restoredRecover, 1).find((action) =>
      action.type === "activateEffect" && action.uid === recoverSource.uid
    );
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(restoredRecover, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRecover, recover!);
    resolveRestoredChain(restoredRecover);

    const lifeSwordsman = requireCard(restoredRecover.session, lifeSwordsmanCode);
    expect(restoredRecover.session.state.players[1].lifePoints).toBe(9800);
    expect(restoredRecover.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventReasonPlayer: trigger.eventReasonPlayer,
      eventTriggerTiming: trigger.eventTriggerTiming,
      eventValue: trigger.eventValue,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-1-1112",
        eventName: "recoveredLifePoints",
        eventPlayer: 1,
        eventReason: duelReason.effect,
        eventReasonCardUid: recoverSource.uid,
        eventReasonEffectId: 3,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        eventValue: 1800,
        player: 0,
        sourceUid: lifeSwordsman.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(restoredRecover.session), customSource(workspace), reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === lifeSwordsman.uid && action.effectId === "lua-1-1112"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    resolveRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === lifeSwordsman.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: lifeSwordsman.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredSummon.session.state.cards.find((card) => card.uid === lifeSwordsman.uid), restoredSummon.session.state)).toBe(1800);
    expect(restoredSummon.session.state.effects.filter((effect) =>
      effect.sourceUid === lifeSwordsman.uid && effect.code === effectSetAttackFinal
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 33492992 }, sourceUid: lifeSwordsman.uid, value: 1800 },
    ]);
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["recoveredLifePoints", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "recoveredLifePoints", eventCode: 1112, eventCardUid: undefined, eventPlayer: 1, eventValue: 1800, eventReason: duelReason.effect, eventReasonPlayer: 1, eventReasonCardUid: recoverSource.uid, eventReasonEffectId: 3, previous: undefined, current: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: lifeSwordsman.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: lifeSwordsman.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
    ]);
    expect(restoredSummon.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredTribute = createRestoredTributeOpen({ reader, workspace });
    expectCleanRestore(restoredTribute);
    expectRestoredLegalActions(restoredTribute, 0);
    const fieldLifeSwordsman = requireCard(restoredTribute.session, lifeSwordsmanCode);
    const ally = requireCard(restoredTribute.session, allyCode);
    const boost = getLuaRestoreLegalActions(restoredTribute, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fieldLifeSwordsman.uid && action.effectId === "lua-2"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredTribute, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTribute, boost!);
    resolveRestoredChain(restoredTribute);

    expect(restoredTribute.session.state.cards.find((card) => card.uid === fieldLifeSwordsman.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: fieldLifeSwordsman.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredTribute.session.state.cards.find((card) => card.uid === ally.uid), restoredTribute.session.state)).toBe(2500);
    const attackUpdateEffects = restoredTribute.session.state.effects.filter((effect) =>
      effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }));
    expect(attackUpdateEffects).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: ally.uid, value: 1000 },
    ]);
    expect(restoredTribute.session.state.eventHistory.filter((event) => ["released", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "released", eventCardUid: fieldLifeSwordsman.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: fieldLifeSwordsman.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "becameTarget", eventCardUid: ally.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previous: "deck", current: "monsterZone" },
    ]);
    expect(restoredTribute.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: lifeSwordsmanCode, name: "Performapal Life Swordsman", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, level: 1, attack: 0, defense: 0 },
    { code: recoverSourceCode, name: "Life Swordsman Recovery Source", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: allyCode, name: "Life Swordsman Ally Target", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
  ];
}

function createRestoredRecoverOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 7268133, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [lifeSwordsmanCode] }, 1: { main: [recoverSourceCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, lifeSwordsmanCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, recoverSourceCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const source = customSource(workspace);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(lifeSwordsmanCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(recoverSourceCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredTributeOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 72681331, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [lifeSwordsmanCode, allyCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, lifeSwordsmanCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(lifeSwordsmanCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function customSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${recoverSourceCode}.lua`) return recoverSourceScript();
      return workspace.readScript(name);
    },
  };
}

function recoverSourceScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_RECOVER)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp) Duel.Recover(tp,1800,REASON_EFFECT) end)
      c:RegisterEffect(e)
    end
  `;
}

function expectLifeSwordsmanScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Performapal Life Swordsman");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetCode(EVENT_RECOVER)");
  expect(script).toContain("return ep~=tp");
  expect(script).toContain("Duel.SpecialSummonStep(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(ev)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetCost(Cost.SelfTribute)");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsFaceup,tp,LOCATION_MZONE,0,1,e:GetHandler())");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
    applyRestoredActionAndAssert(restored, pass!);
  }
}
