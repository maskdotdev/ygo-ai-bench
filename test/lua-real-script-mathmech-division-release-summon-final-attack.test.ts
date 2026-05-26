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
const divisionCode = "89743495";
const emzCyberseCode = "897434950";
const handCyberseCode = "897434951";
const graveCyberseCode = "897434952";
const statTargetCode = "897434953";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDivisionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${divisionCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceCyberse = 0x1000000;
const attributeLight = 0x10;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasDivisionScript)("Lua real script Mathmech Division release summon final attack", () => {
  it("restores EMZ Cyberse release into hand/GY summons and to-Grave final ATK halving", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${divisionCode}.lua`));
    const reader = createCardReader(cards());

    const restoredSummon = createRestoredDivisionSession({ reader, workspace }, { yesPrompts: true });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const division = requireCard(restoredSummon.session, divisionCode);
    const releaseCost = requireCard(restoredSummon.session, emzCyberseCode);
    const handCyberse = requireCard(restoredSummon.session, handCyberseCode);
    const graveCyberse = requireCard(restoredSummon.session, graveCyberseCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "activateEffect" && action.uid === division.uid && action.effectId === "lua-1");
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    resolveRestoredChain(restoredSummon);

    expect(restoredSummon.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([
      { api: "SelectYesNo", player: 0, returned: true },
      { api: "SelectYesNo", player: 0, returned: true },
    ]);
    expect(restoredSummon.session.state.cards.find((card) => card.uid === releaseCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: division.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.cards.find((card) => card.uid === handCyberse.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: division.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.cards.find((card) => card.uid === graveCyberse.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: division.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: releaseCost.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: division.uid, eventReasonEffectId: 1 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: releaseCost.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: division.uid, eventReasonEffectId: 1 },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: handCyberse.uid, eventUids: [handCyberse.uid, graveCyberse.uid], eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: division.uid, eventReasonEffectId: 1 },
    ]);

    const restoredGrave = createRestoredDivisionSession({ reader, workspace });
    expectCleanRestore(restoredGrave);
    const graveDivision = requireCard(restoredGrave.session, divisionCode);
    const statTarget = requireCard(restoredGrave.session, statTargetCode);
    sendDuelCardToGraveyard(restoredGrave.session.state, graveDivision.uid, 0, duelReason.effect, 0);
    expect(restoredGrave.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1014", eventCardUid: graveDivision.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, player: 0, sourceUid: graveDivision.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredGrave.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const halve = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === graveDivision.uid && action.effectId === "lua-2-1014");
    expect(halve, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, halve!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === statTarget.uid), restoredTrigger.session.state)).toBe(1300);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === statTarget.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: effectSetAttackFinal, reset: { flags: 1107169792 }, sourceUid: statTarget.uid, value: 1300 }]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: graveDivision.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: statTarget.uid, eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 2 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("s.listed_series={SET_MATHMECH}");
  expect(script).toContain("return c:GetSequence()>=5 and c:IsRace(RACE_CYBERSE) and c:IsControler(tp)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.costfilter,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.costfilter,1,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("return c:IsLevel(4) and c:IsRace(RACE_CYBERSE) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.NecroValleyFilter(s.spfilter),tp,LOCATION_GRAVE,0,nil,e,tp)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,3))");
  expect(script).toContain("Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()/2)");
}

function cards(): DuelCardData[] {
  return [
    { code: divisionCode, name: "Mathmech Division", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1500, defense: 1000 },
    { code: emzCyberseCode, name: "Mathmech Division EMZ Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: handCyberseCode, name: "Mathmech Division Hand Cyberse", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
    { code: graveCyberseCode, name: "Mathmech Division Grave Cyberse", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1300, defense: 1000 },
    { code: statTargetCode, name: "Mathmech Division ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 2600, defense: 1000 },
  ];
}

function createRestoredDivisionSession(
  { reader, workspace }: { reader: ReturnType<typeof createCardReader>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> },
  options: { yesPrompts?: boolean } = {},
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 89743495, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [divisionCode, emzCyberseCode, handCyberseCode, graveCyberseCode, statTargetCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, divisionCode), 0);
  moveFaceUpAttack(session, requireCard(session, emzCyberseCode), 0).sequence = 5;
  moveDuelCard(session.state, requireCard(session, handCyberseCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, graveCyberseCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, statTargetCode), 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(divisionCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, options.yesPrompts ? { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] } : undefined);
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
