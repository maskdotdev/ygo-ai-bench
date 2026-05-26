import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, linkSummonDuelCard, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const seleneCode = "45819647";
const spellcasterMaterialCode = "458196470";
const genericMaterialCode = "458196471";
const genericMaterialBCode = "458196477";
const summonTargetCode = "458196472";
const endymionAllyCode = "458196473";
const ownSpellCode = "458196474";
const graveSpellCode = "458196475";
const opponentSpellCode = "458196476";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSeleneScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${seleneCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setEndymion = 0x106;
const counterSpell = 0x1;
const effectCannotBeBattleTarget = 70;
const markerRight = 0x20;
const linkSummonReason = duelReason.link | duelReason.summon | duelReason.specialSummon;

describe.skipIf(!hasUpstreamScripts || !hasSeleneScript)("Lua real script Selene counter linked summon", () => {
  it("restores Link Summon counters, battle targeting protection, and counter-cost linked-zone summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectSeleneScriptShape(workspace.readScript(`official/c${seleneCode}.lua`));
    const reader = createCardReader(cards());
    const restoredCounter = createRestoredLinkSummonState({ reader, workspace });
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 0);
    const selene = requireCard(restoredCounter.session, seleneCode);
    const summonTarget = requireCard(restoredCounter.session, summonTargetCode);
    expect(restoredCounter.session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-3-1102", eventCardUid: selene.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: linkSummonReason, eventReasonPlayer: 0, player: 0, sourceUid: selene.uid, triggerBucket: "turnMandatory" },
    ]);
    expect(restoredCounter.session.state.effects.filter((effect) => effect.sourceUid === selene.uid && effect.code === effectCannotBeBattleTarget).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      valuePredicate: typeof effect.valuePredicate,
    }))).toEqual([
      { code: effectCannotBeBattleTarget, event: "continuous", property: 0x20000, range: ["monsterZone"], valuePredicate: "function" },
    ]);
    applyRestoredActionAndAssert(restoredCounter, requireAction(restoredCounter, selene.uid, "activateTrigger"));
    resolveRestoredChain(restoredCounter);
    expect(getDuelCardCounter(requireCard(restoredCounter.session, seleneCode), counterSpell)).toBe(3);
    expect(restoredCounter.session.state.eventHistory.filter((event) => ["specialSummoned", "counterAdded"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: selene.uid, eventReason: linkSummonReason, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: selene.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: selene.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
    ]);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(restoredCounter.session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    applyRestoredActionAndAssert(restoredSummon, requireAction(restoredSummon, selene.uid, "activateEffect"));
    expect(getDuelCardCounter(requireCard(restoredSummon.session, seleneCode), counterSpell)).toBe(0);
    resolveRestoredChain(restoredSummon);
    expect(findCard(restoredSummon.session, summonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 1,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: selene.uid,
      reasonEffectId: 5,
    });
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["counterRemoved", "specialSummoned"].includes(event.eventName)).slice(-2).map(slimEvent)).toEqual([
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: selene.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: selene.uid, eventReasonEffectId: 5, relatedEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: summonTarget.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: selene.uid, eventReasonEffectId: 5, relatedEffectId: undefined, previous: "graveyard", current: "monsterZone" },
    ]);
  });
});

function createRestoredLinkSummonState({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 45819647, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [spellcasterMaterialCode, genericMaterialCode, genericMaterialBCode, summonTargetCode, endymionAllyCode, ownSpellCode, graveSpellCode], extra: [seleneCode] }, 1: { main: [opponentSpellCode] } });
  startDuel(session);
  const selene = requireCard(session, seleneCode);
  const spellcasterMaterial = moveFaceUpAttack(session, requireCard(session, spellcasterMaterialCode), 0, 0);
  const genericMaterial = moveFaceUpAttack(session, requireCard(session, genericMaterialCode), 0, 1);
  const genericMaterialB = moveFaceUpAttack(session, requireCard(session, genericMaterialBCode), 0, 2);
  moveDuelCard(session.state, requireCard(session, summonTargetCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, endymionAllyCode), 0, 4);
  moveFaceUpSpellTrap(session, requireCard(session, ownSpellCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, graveSpellCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpSpellTrap(session, requireCard(session, opponentSpellCode), 1, 0);
  openMain(session);
  registerSelene(session, workspace);
  linkSummonDuelCard(session.state, 0, selene.uid, [spellcasterMaterial.uid, genericMaterial.uid, genericMaterialB.uid]);
  selene.sequence = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerSelene(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(seleneCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectSeleneScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Selene, Queen of the Master Magicians");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
  expect(script).toContain("Link.AddProcedure(c,nil,2,3,s.lcheck)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsLinkSummoned()");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.ctfilter,tp,LOCATION_ONFIELD|LOCATION_GRAVE,LOCATION_ONFIELD|LOCATION_GRAVE,nil)");
  expect(script).toContain("c:AddCounter(COUNTER_SPELL,ct)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)");
  expect(script).toContain("e2:SetValue(aux.imval2)");
  expect(script).toContain("local ph=Duel.GetCurrentPhase()");
  expect(script).toContain("return Duel.IsMainPhase()");
  expect(script).toContain("Duel.IsCanRemoveCounter(tp,1,0,COUNTER_SPELL,3,REASON_COST)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_SPELL,3,REASON_COST)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_HAND|LOCATION_GRAVE,0,1,1,nil,e,tp,zone)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP_DEFENSE,zone)");
}

function cards(): DuelCardData[] {
  return [
    { code: seleneCode, name: "Selene, Queen of the Master Magicians", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceSpellcaster, attribute: attributeDark, level: 3, attack: 1850, defense: 0, linkMarkers: markerRight, linkMaterialMin: 2, linkMaterialMax: 3 },
    { code: spellcasterMaterialCode, name: "Selene Spellcaster Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: genericMaterialCode, name: "Selene Generic Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: genericMaterialBCode, name: "Selene Generic Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: summonTargetCode, name: "Selene Spellcaster Summon Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1400, defense: 1600 },
    { code: endymionAllyCode, name: "Selene Endymion Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, setcodes: [setEndymion], level: 4, attack: 1200, defense: 1000 },
    { code: ownSpellCode, name: "Selene Face-up Spell", kind: "spell", typeFlags: typeSpell },
    { code: graveSpellCode, name: "Selene Grave Spell", kind: "spell", typeFlags: typeSpell },
    { code: opponentSpellCode, name: "Selene Opponent Face-up Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
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

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  return moved;
}

function openMain(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  return action!;
}

function slimEvent(event: {
  eventName: string;
  eventCode?: number;
  eventCardUid?: string;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}) {
  return {
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
  };
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
