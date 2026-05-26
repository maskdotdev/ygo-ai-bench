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
const exareptorCode = "37426272";
const discardCode = "374262720";
const normalLevel3Code = "374262721";
const rank3XyzCode = "374262722";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasExareptorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${exareptorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeNormal = 0x10;
const typeXyz = 0x800000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasExareptorScript)("Lua real script Materiactor Exareptor discard search Xyz stat", () => {
  it("restores reveal-discard search optional summon and self-discard Rank 3 Xyz boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectExareptorScriptShape(workspace.readScript(`official/c${exareptorCode}.lua`));
    const reader = createCardReader(cards());

    const restoredIgnition = createRestoredIgnition({ reader, workspace });
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignitionExareptor = requireCard(restoredIgnition.session, exareptorCode);
    const discard = requireCard(restoredIgnition.session, discardCode);
    const normal = requireCard(restoredIgnition.session, normalLevel3Code);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === ignitionExareptor.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: 0x208, code: undefined, event: "ignition", id: "lua-1", property: undefined, range: ["hand"], triggerEvent: undefined },
      { category: 0x200000, code: 1002, event: "quick", id: "lua-2-1002", property: 0x4010, range: ["hand"], triggerEvent: undefined },
    ]);
    const search = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === ignitionExareptor.uid && action.effectId === "lua-1");
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    expect(search).not.toHaveProperty("operationInfos");
    expect(search).toMatchObject({
      effectId: "lua-1",
    });
    applyRestoredActionAndAssert(restoredIgnition, search!);
    resolveRestoredChain(restoredIgnition);
    expect(restoredIgnition.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectYesNo", player: 0, returned: true }]);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: ignitionExareptor.uid,
      reasonEffectId: 1,
    });
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === normal.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ignitionExareptor.uid,
      reasonEffectId: 1,
    });
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === ignitionExareptor.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: ignitionExareptor.uid,
      reasonEffectId: 1,
    });
    expect(restoredIgnition.session.state.eventHistory.filter((event) => ["confirmed", "sentToGraveyard", "becameTarget", "sentToHand", "sentToHandConfirmed", "breakEffect", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "confirmed", eventCode: 1211, eventCardUid: ignitionExareptor.uid, eventPlayer: 1, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "deck", current: "hand" },
      { eventName: "sentToHandConfirmed", eventCode: 1212, eventCardUid: ignitionExareptor.uid, eventPlayer: 1, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "deck", current: "hand" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: discard.uid, eventPlayer: undefined, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: ignitionExareptor.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "hand", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: discard.uid, eventPlayer: undefined, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: ignitionExareptor.uid, eventReasonEffectId: 1, relatedEffectId: 1, previous: "hand", current: "graveyard" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: normal.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ignitionExareptor.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "deck", current: "hand" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: normal.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ignitionExareptor.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "deck", current: "hand" },
      { eventName: "sentToHandConfirmed", eventCode: 1212, eventCardUid: normal.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ignitionExareptor.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "deck", current: "hand" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ignitionExareptor.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: ignitionExareptor.uid, eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: ignitionExareptor.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "hand", current: "monsterZone" },
    ]);

    const restoredQuick = createRestoredQuick({ reader, workspace });
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const quickExareptor = requireCard(restoredQuick.session, exareptorCode);
    const xyz = requireCard(restoredQuick.session, rank3XyzCode);
    const boost = getLuaRestoreLegalActions(restoredQuick, 0).find((action) => action.type === "activateEffect" && action.uid === quickExareptor.uid && action.effectId === "lua-2-1002");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, boost!);
    expect(restoredQuick.session.state.chain).toHaveLength(0);
    expect(restoredQuick.session.state.cards.find((card) => card.uid === quickExareptor.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: quickExareptor.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === xyz.uid), restoredQuick.session.state)).toBe(3500);
    expect(restoredQuick.session.state.effects.filter((effect) => effect.code === effectUpdateAttack && effect.value === 1500).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 1107169792 }, sourceUid: xyz.uid, value: 1500 },
    ]);
    expect(restoredQuick.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget"].includes(event.eventName)).map((event) => ({
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
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: quickExareptor.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: quickExareptor.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "hand", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: xyz.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previous: "extraDeck", current: "monsterZone" },
    ]);
    expect(restoredQuick.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredIgnition({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 37426272, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [exareptorCode, discardCode, normalLevel3Code] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, exareptorCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, discardCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(exareptorCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
}

function createRestoredQuick({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 37426273, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [exareptorCode], extra: [rank3XyzCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, exareptorCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, rank3XyzCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(exareptorCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectExareptorScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("e1:SetCost(s.thcost)");
  expect(script).toContain("return not c:IsPublic() and Duel.IsExistingMatchingCard(nil,tp,LOCATION_HAND,0,1,c)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,c)");
  expect(script).toContain("Duel.DiscardHand(tp,nil,1,1,REASON_COST|REASON_DISCARD,c)");
  expect(script).toContain("Duel.SetTargetCard(Duel.GetOperatedGroup():GetFirst())");
  expect(script).toContain("Duel.ShuffleHand(tp)");
  expect(script).toContain("return c:IsLevel(3) and c:IsType(TYPE_NORMAL) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK|LOCATION_GRAVE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,tp,0)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.thfilter),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,exc)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e2:SetCondition(function() return not (Duel.IsPhase(PHASE_DAMAGE) and Duel.IsDamageCalculated()) end)");
  expect(script).toContain("e2:SetCost(Cost.SelfDiscard)");
  expect(script).toContain("return c:IsRank(3) and c:IsType(TYPE_XYZ) and c:IsFaceup()");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1500)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: exareptorCode, name: "Materiactor Exareptor", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeWater, level: 3, attack: 1500, defense: 1500 },
    { code: discardCode, name: "Exareptor Discard Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: normalLevel3Code, name: "Exareptor Level 3 Normal", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceDragon, attribute: attributeWater, level: 3, attack: 1000, defense: 1000 },
    { code: rank3XyzCode, name: "Exareptor Rank 3 Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeWater, level: 3, attack: 2000, defense: 2000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
