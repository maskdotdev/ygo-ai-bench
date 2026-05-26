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
const moleCode = "71228611";
const hiddenBeastCode = "712286110";
const koalaCode = "712286111";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMoleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${moleCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceBeast = 0x4000;
const attributeEarth = 0x1;
const setKoala = 0x67;

describe.skipIf(!hasUpstreamScripts || !hasMoleScript)("Lua real script Eucalyptus Mole summon Koala stat", () => {
  it("restores summon face-down Beast branch, destroyed Koala summon, field ATK boost, and battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${moleCode}.lua`));
    const reader = createCardReader(cards());

    const summonSession = createDuel({ seed: 71228611, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(summonSession, { 0: { main: [moleCode, hiddenBeastCode, koalaCode] }, 1: { main: [] } });
    startDuel(summonSession);
    const summonMole = requireCard(summonSession, moleCode);
    moveToHand(summonSession, summonMole, 0);
    summonSession.state.phase = "main1";
    summonSession.state.turnPlayer = 0;
    summonSession.state.waitingFor = 0;

    const summonHost = createLuaScriptHost(summonSession, workspace);
    expect(summonHost.loadCardScript(Number(moleCode), workspace).ok).toBe(true);
    expect(summonHost.registerInitialEffects()).toBe(1);

    const restoredSummonOpen = restoreDuelWithLuaScripts(serializeDuel(summonSession), workspace, reader);
    expectCleanRestore(restoredSummonOpen);
    expectRestoredLegalActions(restoredSummonOpen, 0);
    const normalSummon = getLuaRestoreLegalActions(restoredSummonOpen, 0).find((action) => action.type === "normalSummon" && action.uid === summonMole.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonOpen, normalSummon!);

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummonOpen.session), workspace, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    expect(restoredSummonTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1100",
        eventCardUid: summonMole.uid,
        eventCode: 1100,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "normalSummoned",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: summonMole.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    const summonTrigger = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === summonMole.uid);
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonTrigger, summonTrigger!);
    resolveRestoredChain(restoredSummonTrigger);
    const hiddenBeast = restoredSummonTrigger.session.state.cards.find((card) => card.code === hiddenBeastCode);
    expect(hiddenBeast).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceDownDefense",
      faceUp: false,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: summonMole.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummonTrigger.session.state.cards.find((card) => card.uid === summonMole.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpDefense", faceUp: true });
    expect(restoredSummonTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "confirmed", "breakEffect", "positionChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: hiddenBeast?.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonMole.uid,
        eventReasonEffectId: 1,
        eventUids: [hiddenBeast?.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 1 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: hiddenBeast?.uid,
        eventPlayer: 1,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonMole.uid,
        eventReasonEffectId: 1,
        eventValue: 1,
        eventUids: [hiddenBeast?.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 1 },
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonMole.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: summonMole.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonMole.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);

    const destroyedSession = createDuel({ seed: 71228612, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(destroyedSession, { 0: { main: [moleCode, hiddenBeastCode, koalaCode] }, 1: { main: [] } });
    startDuel(destroyedSession);
    const destroyedMole = requireCard(destroyedSession, moleCode);
    const fieldBeast = requireCard(destroyedSession, hiddenBeastCode);
    moveFaceUpAttack(destroyedSession, destroyedMole, 0, 0);
    moveFaceUpAttack(destroyedSession, fieldBeast, 0, 1);
    destroyedSession.state.phase = "main1";
    destroyedSession.state.turnPlayer = 0;
    destroyedSession.state.waitingFor = 0;

    const destroyedHost = createLuaScriptHost(destroyedSession, workspace);
    expect(destroyedHost.loadCardScript(Number(moleCode), workspace).ok).toBe(true);
    expect(destroyedHost.registerInitialEffects()).toBe(1);
    destroyDuelCard(destroyedSession.state, destroyedMole.uid, 0, duelReason.effect | duelReason.destroy, 0);

    const restoredDestroyedTrigger = restoreDuelWithLuaScripts(serializeDuel(destroyedSession), workspace, reader);
    expectCleanRestore(restoredDestroyedTrigger);
    expectRestoredLegalActions(restoredDestroyedTrigger, 0);
    expect(restoredDestroyedTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1029",
        eventCardUid: destroyedMole.uid,
        eventCode: 1029,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventName: "destroyed",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: destroyedMole.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    const destroyedTrigger = getLuaRestoreLegalActions(restoredDestroyedTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === destroyedMole.uid);
    expect(destroyedTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyedTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyedTrigger, destroyedTrigger!);
    resolveRestoredChain(restoredDestroyedTrigger);
    const summonedKoala = restoredDestroyedTrigger.session.state.cards.find((card) => card.code === koalaCode);
    expect(summonedKoala).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: destroyedMole.uid,
      reasonEffectId: 3,
    });

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyedTrigger.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    const boostedBeast = restoredBoost.session.state.cards.find((card) => card.uid === fieldBeast.uid);
    expect(currentAttack(boostedBeast, restoredBoost.session.state)).toBe(2800);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === summonedKoala?.uid), restoredBoost.session.state)).toBe(500);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      luaValueDescriptor: effect.luaValueDescriptor,
    }))).toEqual([
      {
        code: 100,
        event: "continuous",
        reset: { flags: 1073742336, count: 2 },
        sourceUid: destroyedMole.uid,
        targetRange: [4, 0],
        value: undefined,
        luaTargetDescriptor: "target:non-effect-race:16384",
        luaValueDescriptor: "stat:base-defense",
      },
    ]);

    restoredBoost.session.state.phase = "battle";
    restoredBoost.session.state.turnPlayer = 0;
    restoredBoost.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBoost, 0);
    const attack = getLuaRestoreLegalActions(restoredBoost, 0).find((action) => action.type === "declareAttack" && action.attackerUid === fieldBeast.uid && action.targetUid === undefined);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, attack!);
    finishRestoredBattle(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 2800 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_POSITION+CATEGORY_SET)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsLevelBelow(4) and c:IsRace(RACE_BEAST) and c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_POSITION,e:GetHandler(),1,tp,POS_FACEUP_DEFENSE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.fdspfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.ChangePosition(c,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e3:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("return c:IsSetCard(SET_KOALA) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("aux.RegisterClientHint(c,0,tp,1,0,aux.Stringid(id,2))");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,0)");
  expect(script).toContain("e1:SetTarget(function(e,c) return c:IsNonEffectMonster() and c:IsRace(RACE_BEAST) end)");
  expect(script).toContain("e1:SetValue(function(e,c) return c:GetBaseDefense() end)");
  expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_END,2)");
}

function cards(): DuelCardData[] {
  return [
    { code: moleCode, name: "Eucalyptus Mole", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 3, attack: 400, defense: 600 },
    { code: hiddenBeastCode, name: "Eucalyptus Normal Beast", kind: "monster", typeFlags: typeMonster, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1800 },
    { code: koalaCode, name: "Eucalyptus Koala", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 5, attack: 500, defense: 1500, setcodes: [setKoala] },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveToHand(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "hand", player);
  moved.faceUp = false;
  moved.position = "faceDown";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
