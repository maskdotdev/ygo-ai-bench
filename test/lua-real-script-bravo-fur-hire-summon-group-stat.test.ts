import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const bravoCode = "66740005";
const handFurHireCode = "667400050";
const opponentFurHireCode = "667400051";
const offSetCode = "667400052";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBravoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bravoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeEarth = 0x1;
const setFurHire = 0x114;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;

describe.skipIf(!hasUpstreamScripts || !hasBravoScript)("Lua real script Bravo Fur Hire summon group stat", () => {
  it("restores hand Fur Hire Special Summon and delayed all-field ATK/DEF boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${bravoCode}.lua`);
    expectBravoScriptShape(script);
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const bravo = requireCard(restoredOpen.session, bravoCode);
    const handFurHire = requireCard(restoredOpen.session, handFurHireCode);
    const opponentFurHire = requireCard(restoredOpen.session, opponentFurHireCode);
    const offSet = requireCard(restoredOpen.session, offSetCode);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === bravo.uid && action.effectId === "lua-1"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === handFurHire.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: bravo.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventReasonPlayer: trigger.eventReasonPlayer,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-2-1102",
        eventCardUid: handFurHire.uid,
        eventName: "specialSummoned",
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonCardUid: bravo.uid,
        eventReasonEffectId: 1,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: bravo.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const boost = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === bravo.uid && action.effectId === "lua-2-1102"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, boost!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === bravo.uid), restoredTrigger.session.state)).toBe(2400);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === bravo.uid), restoredTrigger.session.state)).toBe(700);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === handFurHire.uid), restoredTrigger.session.state)).toBe(1700);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === handFurHire.uid), restoredTrigger.session.state)).toBe(1300);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentFurHire.uid), restoredTrigger.session.state)).toBe(2000);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === opponentFurHire.uid), restoredTrigger.session.state)).toBe(1500);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === offSet.uid), restoredTrigger.session.state)).toBe(900);
    expect(restoredTrigger.session.state.effects.filter((effect) =>
      [effectUpdateAttack, effectUpdateDefense].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: bravo.uid, value: 500 },
      { code: effectUpdateDefense, reset: { flags: 1107169792 }, sourceUid: bravo.uid, value: 500 },
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: handFurHire.uid, value: 500 },
      { code: effectUpdateDefense, reset: { flags: 1107169792 }, sourceUid: handFurHire.uid, value: 500 },
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: opponentFurHire.uid, value: 500 },
      { code: effectUpdateDefense, reset: { flags: 1107169792 }, sourceUid: opponentFurHire.uid, value: 500 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: handFurHire.uid, eventCode: 1102, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: bravo.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: bravoCode, name: "Bravo, Fighter Fur Hire", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, setcodes: [setFurHire], level: 4, attack: 1900, defense: 200 },
    { code: handFurHireCode, name: "Bravo Hand Fur Hire", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, setcodes: [setFurHire], level: 4, attack: 1200, defense: 800 },
    { code: opponentFurHireCode, name: "Bravo Opponent Fur Hire", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, setcodes: [setFurHire], level: 4, attack: 1500, defense: 1000 },
    { code: offSetCode, name: "Bravo Off-Set Monster", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, level: 4, attack: 900, defense: 900 },
  ];
}

function createRestoredOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 66740005, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [bravoCode, handFurHireCode, offSetCode] }, 1: { main: [opponentFurHireCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, bravoCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, handFurHireCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, offSetCode), 0, 2);
  moveFaceUpAttack(session, requireCard(session, opponentFurHireCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(bravoCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectBravoScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Bravo, Fighter Fur Hire");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("return c:IsSetCard(SET_FUR_HIRE) and not c:IsCode(id) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return not eg:IsContains(e:GetHandler()) and eg:IsExists(s.cfilter,1,nil,tp)");
  expect(script).toContain("Duel.GetMatchingGroup(s.atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
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
