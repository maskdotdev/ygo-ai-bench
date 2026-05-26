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
const motorCode = "77672444";
const tokenCode = "82556059";
const tributeCode = "776724440";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMotorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${motorCode}.lua`));
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;
const typeToken = 0x4000;
const raceMachine = 0x20;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectCannotChangePosition = 14;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasMotorScript)("Lua real script Motor Frenzy tribute stat token", () => {
  it("restores Tribute Summon event targeting into ATK/position lock and sent-to-GY Engine Tokens", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectMotorScriptShape(workspace.readScript(`official/c${motorCode}.lua`));
    const reader = createCardReader(cards());

    const restoredOpen = createRestoredTributeWindow({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const motor = requireCard(restoredOpen.session, motorCode);
    const tribute = requireCard(restoredOpen.session, tributeCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === motor.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: 0x200000, code: 1100, countLimit: 1, event: "trigger", id: "lua-1-1100", property: 0x14000, range: ["monsterZone"], triggerEvent: "normalSummoned" },
      { category: 0x200000, code: 1102, countLimit: 1, event: "trigger", id: "lua-2-1102", property: 0x14000, range: ["monsterZone"], triggerEvent: "specialSummoned" },
      { category: 0x600, code: 1014, countLimit: 1, event: "trigger", id: "lua-3-1014", property: 0x10000, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "sentToGraveyard" },
    ]);
    const tributeSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "tributeSummon" && action.uid === motor.uid && action.tributeUids.includes(tribute.uid),
    );
    expect(tributeSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, tributeSummon!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === motor.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "tribute",
      reason: duelReason.summon,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === tribute.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.summon,
      reasonPlayer: 0,
      reasonCardUid: motor.uid,
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-1-1100", eventCardUid: motor.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonPlayer: 0, player: 0, sourceUid: motor.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const boost = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === motor.uid && action.effectId === "lua-1-1100",
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, boost!);
    resolveRestoredChain(restoredTrigger);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === motor.uid), restoredTrigger.session.state)).toBe(2700);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === motor.uid && [effectUpdateAttack, effectCannotChangePosition].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      description: effect.description,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, description: undefined, event: "continuous", property: undefined, range: ["monsterZone"], reset: { flags: 1644040704 }, sourceUid: motor.uid, value: 600 },
      { code: effectCannotChangePosition, description: 3313, event: "continuous", property: 0x4000000, range: ["monsterZone"], reset: { flags: 1644040704 }, sourceUid: motor.uid, value: undefined },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard", "normalSummoned", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: tribute.uid, eventReason: duelReason.release | duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: tribute.uid, eventReason: duelReason.release | duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: motor.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: motor.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previous: "hand", current: "monsterZone" },
    ]);

    const restoredToGraveOpen = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredToGraveOpen);
    expectRestoredLegalActions(restoredToGraveOpen, 0);
    sendDuelCardToGraveyard(restoredToGraveOpen.session.state, motor.uid, 0, duelReason.effect, 0, {
      eventReasonCardUid: motor.uid,
      eventReasonEffectId: 900,
    });
    expect(restoredToGraveOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1014", eventCardUid: motor.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: motor.uid, eventReasonEffectId: 900, eventReasonPlayer: 0, player: 0, sourceUid: motor.uid, triggerBucket: "turnOptional" },
    ]);
    const restoredTokenTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredToGraveOpen.session), workspace, reader);
    expectCleanRestore(restoredTokenTrigger);
    expectRestoredLegalActions(restoredTokenTrigger, 0);
    const tokenSummon = getLuaRestoreLegalActions(restoredTokenTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === motor.uid && action.effectId === "lua-3-1014",
    );
    expect(tokenSummon, JSON.stringify(getLuaRestoreLegalActions(restoredTokenTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTokenTrigger, tokenSummon!);
    resolveRestoredChain(restoredTokenTrigger);
    const tokens = restoredTokenTrigger.session.state.cards.filter((card) => card.code === tokenCode).sort((a, b) => a.uid.localeCompare(b.uid));
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ location: "monsterZone", controller: 0, owner: 0, faceUp: true, position: "faceUpAttack", reason: duelReason.summon | duelReason.specialSummon, reasonPlayer: 0, reasonCardUid: motor.uid, reasonEffectId: 3 });
    expect(tokens[1]).toMatchObject({ location: "monsterZone", controller: 0, owner: 0, faceUp: true, position: "faceUpAttack", reason: duelReason.summon | duelReason.specialSummon, reasonPlayer: 0, reasonCardUid: motor.uid, reasonEffectId: 3 });
    expect(restoredTokenTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: tokens[0]!.uid, eventUids: [tokens[0]!.uid, tokens[1]!.uid], eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: motor.uid, eventReasonEffectId: 3, previous: "hand", current: "monsterZone" },
    ]);
    expect(restoredTokenTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredTributeWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 77672444, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [motorCode, tributeCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, motorCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, tributeCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(motorCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectMotorScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Motor Frenzy");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return eg:IsExists(s.atkconfilter,1,nil,e:GetHandler(),tp)");
  expect(script).toContain("Duel.SetTargetCard(eg)");
  expect(script).toContain("local g=eg:Filter(Card.IsRelateToEffect,nil,e)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END|RESET_OPPO_TURN)");
  expect(script).toContain("e1:SetValue(tc:GetBaseDefense()/2)");
  expect(script).toContain("e1:SetDescription(3313)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_CHANGE_POSITION)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("c:IsPreviousLocation(LOCATION_MZONE) and c:IsTributeSummoned()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOKEN,nil,2,0,0)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,2,tp,0)");
  expect(script).toContain("Duel.CreateToken(tp,TOKEN_ENGINE)");
  expect(script).toContain("Duel.SpecialSummonStep(token,0,tp,tp,false,false,POS_FACEUP_ATTACK)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
}

function cards(): DuelCardData[] {
  return [
    { code: motorCode, name: "Motor Frenzy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 6, attack: 2100, defense: 1200 },
    { code: tokenCode, name: "Engine Token", kind: "monster", typeFlags: typeMonster | typeNormal | typeToken, race: raceMachine, attribute: attributeEarth, level: 1, attack: 200, defense: 200 },
    { code: tributeCode, name: "Motor Frenzy Tribute Machine", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
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
