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
const abominationCode = "31600845";
const administratorCode = "94821366";
const familyFacesCode = "20989253";
const amazementFieldCode = "316008450";
const statTargetCode = "316008451";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasAbominationScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${abominationCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceFiend = 0x100000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;
const setAmazement = 0x15e;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasAbominationScript)("Lua real script Amazement Abomination Arlekino summon search to-deck stat", () => {
  it("restores hand Special Summon search and opponent-turn shuffle Summon ATK-zero branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${abominationCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredHand = createRestoredHandSummonWindow({ reader, workspace });
    expectCleanRestore(restoredHand);
    expectRestoredLegalActions(restoredHand, 0);
    const handAbomination = requireCard(restoredHand.session, abominationCode);
    const familyFaces = requireCard(restoredHand.session, familyFacesCode);
    const handEffect = getLuaRestoreLegalActions(restoredHand, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handAbomination.uid && action.effectId === "lua-1"
    );
    expect(handEffect, JSON.stringify(getLuaRestoreLegalActions(restoredHand, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredHand, handEffect!);
    resolveRestoredChain(restoredHand);

    expect(restoredHand.session.state.cards.find((card) => card.uid === handAbomination.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: handAbomination.uid,
      reasonEffectId: 1,
    });
    expect(restoredHand.session.state.cards.find((card) => card.uid === familyFaces.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: handAbomination.uid,
      reasonEffectId: 1,
    });
    expect(restoredHand.host.messages).toContain(`confirmed 1: ${familyFacesCode}`);
    expect(restoredHand.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: handAbomination.uid, eventCode: 1102, eventName: "specialSummoned", eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: handAbomination.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: familyFaces.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: handAbomination.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: familyFaces.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: handAbomination.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: familyFaces.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: handAbomination.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
    ]);
    expect(restoredHand.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredQuick = createRestoredQuickWindow({ reader, workspace });
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const quickAbomination = requireCard(restoredQuick.session, abominationCode);
    const administrator = requireCard(restoredQuick.session, administratorCode);
    const statTarget = requireCard(restoredQuick.session, statTargetCode);
    const quick = getLuaRestoreLegalActions(restoredQuick, 0).find((action) =>
      action.type === "activateEffect" && action.uid === quickAbomination.uid && action.effectId.startsWith("lua-2")
    );
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, quick!);
    resolveRestoredChain(restoredQuick);

    expect(restoredQuick.session.state.cards.find((card) => card.uid === quickAbomination.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: quickAbomination.uid,
      reasonEffectId: 2,
    });
    expect(restoredQuick.session.state.cards.find((card) => card.uid === administrator.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: quickAbomination.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === statTarget.uid), restoredQuick.session.state)).toBe(0);
    expect(restoredQuick.session.state.effects.filter((effect) => effect.sourceUid === statTarget.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 33427456 }, sourceUid: statTarget.uid, value: 0 },
    ]);
    expect(restoredQuick.session.state.eventHistory.filter((event) => ["becameTarget", "sentToDeck", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: statTarget.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 2 },
      { eventCardUid: quickAbomination.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: quickAbomination.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: administrator.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: quickAbomination.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);
    expect(restoredQuick.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredHandSummonWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 31600845, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [abominationCode, amazementFieldCode, familyFacesCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, abominationCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, amazementFieldCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(abominationCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredQuickWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 31600846, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [abominationCode, administratorCode] }, 1: { main: [statTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, abominationCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, statTargetCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(abominationCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Amazement Abomination Arlekino");
  expect(script).toContain("CATEGORY_SPECIAL_SUMMON+CATEGORY_TOHAND+CATEGORY_SEARCH");
  expect(script).toContain("EFFECT_TYPE_IGNITION");
  expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("Duel.GetMatchingGroup(aux.NecroValleyFilter(s.thfilter),tp,LOCATION_DECK|LOCATION_GRAVE,0,nil)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("Duel.SendtoHand(sg,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,sg)");
  expect(script).toContain("CATEGORY_TODECK+CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE");
  expect(script).toContain("EFFECT_TYPE_QUICK_O");
  expect(script).toContain("EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP");
  expect(script).toContain("return Duel.IsTurnPlayer(1-tp)");
  expect(script).toContain("Duel.GetMZoneCount(tp,c)>0");
  expect(script).toContain("Duel.SelectTarget(tp,s.cfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,c)");
  expect(script).toContain("Duel.SendtoDeck(c,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)>0");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("EFFECT_SET_ATTACK_FINAL");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const databaseCards = workspace.readDatabaseCards("cards.cdb");
  const abomination = databaseCards.find((card) => card.code === abominationCode);
  const administrator = databaseCards.find((card) => card.code === administratorCode);
  const familyFaces = databaseCards.find((card) => card.code === familyFacesCode);
  expect(abomination).toBeDefined();
  expect(administrator).toBeDefined();
  expect(familyFaces).toBeDefined();
  return [
    { ...abomination!, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeLight, level: 7, attack: 2600, defense: 2200 },
    { ...administrator!, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 7, attack: 2600, defense: 2200 },
    { ...familyFaces!, kind: "trap", typeFlags: typeTrap },
    { code: amazementFieldCode, name: "Amazement Field Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeLight, level: 4, attack: 1500, defense: 1000, setcodes: [setAmazement] },
    { code: statTargetCode, name: "Amazement ATK Zero Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
