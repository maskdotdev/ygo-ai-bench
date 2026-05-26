import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const gliderCode = "45885288";
const discardMonsterCode = "458852880";
const normalDragonCode = "458852881";
const opponentACode = "458852882";
const opponentBCode = "458852883";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGliderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gliderCode}.lua`));
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceDragon = 0x2000;
const attributeLight = 0x10;
const attributeDark = 0x20;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasGliderScript)("Lua real script Neo Kaiser Glider discard revive attack drop", () => {
  it("restores discard-cost Dragon Normal revive and to-Grave opponent ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${gliderCode}.lua`));
    const reader = createCardReader(cards());

    const restoredRevive = createRestoredGliderSession({ reader, workspace });
    expectCleanRestore(restoredRevive);
    expectRestoredLegalActions(restoredRevive, 0);
    const glider = requireCard(restoredRevive.session, gliderCode);
    const discard = requireCard(restoredRevive.session, discardMonsterCode);
    const dragon = requireCard(restoredRevive.session, normalDragonCode);
    const revive = getLuaRestoreLegalActions(restoredRevive, 0).find((action) => action.type === "activateEffect" && action.uid === glider.uid && action.effectId === "lua-1");
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredRevive, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRevive, revive!);
    resolveRestoredChain(restoredRevive);

    expect(restoredRevive.session.state.cards.find((card) => card.uid === glider.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: glider.uid,
      reasonEffectId: 1,
    });
    expect(restoredRevive.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: glider.uid,
      reasonEffectId: 1,
    });
    expect(restoredRevive.session.state.cards.find((card) => card.uid === dragon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: glider.uid,
      reasonEffectId: 1,
    });
    const reviveEvents = restoredRevive.session.state.eventHistory.filter((event) => ["discarded", "sentToGraveyard", "becameTarget", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }));
    expect(reviveEvents).toEqual([
      { eventName: "discarded", eventCode: 1018, eventCardUid: discard.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: glider.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: discard.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: glider.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "discarded", eventCode: 1018, eventCardUid: glider.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: glider.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: glider.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: glider.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: discard.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: glider.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: dragon.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1 },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: dragon.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: glider.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
    ]);

    const restoredToGrave = createRestoredGliderSession({ reader, workspace });
    expectCleanRestore(restoredToGrave);
    const triggerGlider = requireCard(restoredToGrave.session, gliderCode);
    const opponentA = requireCard(restoredToGrave.session, opponentACode);
    const opponentB = requireCard(restoredToGrave.session, opponentBCode);
    moveFaceUpAttack(restoredToGrave.session, opponentA, 1);
    moveFaceUpAttack(restoredToGrave.session, opponentB, 1);
    sendDuelCardToGraveyard(restoredToGrave.session.state, triggerGlider.uid, 0, duelReason.effect, 0);
    expect(restoredToGrave.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1014", eventCardUid: triggerGlider.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, player: 0, sourceUid: triggerGlider.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredToGrave.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const drop = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === triggerGlider.uid && action.effectId === "lua-2-1014");
    expect(drop, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, drop!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentA.uid), restoredTrigger.session.state)).toBe(1300);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentB.uid), restoredTrigger.session.state)).toBe(1900);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.code === effectUpdateAttack && [opponentA.uid, opponentB.uid].includes(effect.sourceUid)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 1107169792 }, sourceUid: opponentA.uid, value: -500 },
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 1107169792 }, sourceUid: opponentB.uid, value: -500 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: triggerGlider.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.AND(Card.IsMonster,Card.IsDiscardable),tp,LOCATION_HAND,0,1,1,c)");
  expect(script).toContain("Duel.SendtoGrave(g+c,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("return c:IsRace(RACE_DRAGON) and c:IsType(TYPE_NORMAL) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-500)");
}

function cards(): DuelCardData[] {
  return [
    { code: gliderCode, name: "Neo Kaiser Glider", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 6, attack: 2400, defense: 2200 },
    { code: discardMonsterCode, name: "Neo Kaiser Glider Discard Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: normalDragonCode, name: "Neo Kaiser Glider Normal Dragon", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceDragon, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
    { code: opponentACode, name: "Neo Kaiser Glider Opponent A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: opponentBCode, name: "Neo Kaiser Glider Opponent B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 2400, defense: 1000 },
  ];
}

function createRestoredGliderSession({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 45885288, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [gliderCode, discardMonsterCode, normalDragonCode] }, 1: { main: [opponentACode, opponentBCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, gliderCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, discardMonsterCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, normalDragonCode).uid, "graveyard", 0).faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gliderCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
