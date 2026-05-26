import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const guiltCode = "88695895";
const diabellstarCode = "886958950";
const opponentSummonCode = "886958951";
const opponentTargetCode = "886958952";
const opponentStarterCode = "886958953";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGuiltScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${guiltCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const typeTrap = 0x4;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setDiabellstar = 0x1203;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasGuiltScript)("Lua real script Guilt of the Sinful Spoils summon to-Deck grave stat", () => {
  it("restores opponent Deck/Extra Special Summon trigger into targeted monster shuffle", () => {
    const { workspace, reader, session } = createGuiltSession(88695895);
    const guilt = requireCard(session, guiltCode);
    const diabellstar = requireCard(session, diabellstarCode);
    const summoned = requireCard(session, opponentSummonCode);
    const target = requireCard(session, opponentTargetCode);
    const starter = requireCard(session, opponentStarterCode);
    moveDuelCard(session.state, guilt.uid, "spellTrapZone", 0);
    guilt.position = "faceDown";
    guilt.faceUp = false;
    moveFaceUpAttack(session, diabellstar, 0, 0);
    moveFaceUpAttack(session, target, 1, 0);
    moveDuelCard(session.state, starter.uid, "hand", 1);
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    const source = {
      readScript(name: string) {
        if (name === `c${opponentStarterCode}.lua`) return opponentExtraSummonStarterScript(opponentSummonCode);
        return workspace.readScript(name);
      },
    };
    expect(host.loadCardScript(Number(guiltCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentStarterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const summonAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(summonAction, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, summonAction!);
    resolveEngineChain(session);
    expect(session.state.cards.find((card) => card.uid === summoned.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    summoned.summonPlayer = 1;
    session.state.waitingFor = 0;

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const trigger = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === guilt.uid && action.effectId === "lua-1-1102"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, trigger!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "deck",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: guilt.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === summoned.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToDeck").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: target.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: guilt.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "monsterZone", current: "deck" },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores grave SelfBanish Damage Step target into opponent battle ATK halve", () => {
    const { workspace, reader, session } = createGuiltSession(88695896);
    const guilt = requireCard(session, guiltCode);
    const diabellstar = requireCard(session, diabellstarCode);
    const target = requireCard(session, opponentTargetCode);
    moveDuelCard(session.state, guilt.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, diabellstar, 0, 0);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(guiltCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSetup);
    expectRestoredLegalActions(restoredSetup, 0);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find((action) => action.type === "declareAttack" && action.attackerUid === diabellstar.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, attack!);
    passRestoredBattleAction(restoredSetup, 1, "passAttack");
    passRestoredBattleAction(restoredSetup, 0, "passAttack");
    passRestoredBattleAction(restoredSetup, 1, "passDamage");

    const halve = getLuaRestoreLegalActions(restoredSetup, 0).find((action) => action.type === "activateEffect" && action.uid === guilt.uid && action.effectId === "lua-2-1002");
    expect(halve, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, halve!);
    passRestoredChain(restoredSetup);

    expect(restoredSetup.session.state.cards.find((card) => card.uid === guilt.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: guilt.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredSetup.session.state.cards.find((card) => card.uid === target.uid), restoredSetup.session.state)).toBe(1000);
    expect(restoredSetup.session.state.effects.filter((effect) => effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: 0x400, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 1000 },
    ]);
    expect(restoredSetup.session.state.eventHistory.filter((event) => ["banished", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: guilt.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: guilt.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard", current: "banished", relatedEffectId: undefined },
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "monsterZone", relatedEffectId: 2 },
    ]);
    expect(restoredSetup.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createGuiltSession(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${guiltCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [guiltCode, diabellstarCode] },
    1: { main: [opponentTargetCode, opponentStarterCode], extra: [opponentSummonCode] },
  });
  startDuel(session);
  return { workspace, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Guilt of the Sinful Spoils");
  expect(script).toContain("e1:SetCategory(CATEGORY_TODECK)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsSummonPlayer(1-tp) and c:IsSummonLocation(LOCATION_DECK|LOCATION_EXTRA)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToDeck,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("local a,b=Duel.GetBattleMonster(tp)");
  expect(script).toContain("Duel.IsPhase(PHASE_DAMAGE)");
  expect(script).toContain("Duel.SetTargetCard(b)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()/2)");
}

function cards(): DuelCardData[] {
  return [
    { code: guiltCode, name: "Guilt of the Sinful Spoils", kind: "trap", typeFlags: typeTrap },
    { code: diabellstarCode, name: "Guilt Fixture Diabellstar", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 7, attack: 2500, defense: 2000, setcodes: [setDiabellstar] },
    { code: opponentSummonCode, name: "Guilt Fixture Opponent Extra Summon", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceWarrior, attribute: attributeDark, level: 0, attack: 1500, defense: 0 },
    { code: opponentTargetCode, name: "Guilt Fixture Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2000, defense: 1000 },
    { code: opponentStarterCode, name: "Guilt Fixture Opponent Summon Starter", kind: "spell", typeFlags: 0x2 },
  ];
}

function opponentExtraSummonStarterScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0
          and Duel.IsExistingMatchingCard(Card.IsCode,tp,LOCATION_EXTRA,0,1,nil,${targetCode}) end
        Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_EXTRA)
      end)
      e:SetOperation(function(e,tp)
        local g=Duel.SelectMatchingCard(tp,Card.IsCode,tp,LOCATION_EXTRA,0,1,1,nil,${targetCode})
        Duel.SpecialSummon(g,SUMMON_TYPE_LINK,tp,tp,false,false,POS_FACEUP_ATTACK)
      end)
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function resolveEngineChain(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLegalActions(session, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player!), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, type: "passAttack" | "passDamage"): void {
  expectRestoredLegalActions(restored, player);
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}
