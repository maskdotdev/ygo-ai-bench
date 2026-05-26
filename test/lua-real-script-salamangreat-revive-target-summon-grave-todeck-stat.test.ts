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
const reviveCode = "19027895";
const fireTargetCode = "190278950";
const salamangreatCode = "190278951";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasReviveScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${reviveCode}.lua`));
const setSalamangreat = 0x119;
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceCyberse = 0x1000000;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasReviveScript)("Lua real script Salamangreat Revive target summon grave to-Deck stat", () => {
  it("restores targeted FIRE revive and grave same-name shuffle into ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${reviveCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const summonWindow = createRestoredSummonWindow({ reader, workspace });
    expectCleanRestore(summonWindow.restored);
    expectRestoredLegalActions(summonWindow.restored, 0);
    const activate = getLuaRestoreLegalActions(summonWindow.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === summonWindow.revive.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(summonWindow.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summonWindow.restored, activate!);
    resolveRestoredChain(summonWindow.restored);
    expect(summonWindow.restored.session.state.cards.find((card) => card.uid === summonWindow.revive.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
    });
    expect(summonWindow.restored.session.state.cards.find((card) => card.uid === summonWindow.fireTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonWindow.revive.uid,
      reasonEffectId: 1,
    });
    expect(summonWindow.restored.session.state.eventHistory.filter((event) => ["becameTarget", "specialSummoning", "specialSummoned", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: summonWindow.fireTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: undefined, previous: "deck", current: "graveyard" },
      { eventName: "specialSummoning", eventCode: 1105, eventCardUid: summonWindow.fireTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: undefined, previous: "deck", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: summonWindow.fireTarget.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: summonWindow.revive.uid, eventReasonEffectId: 1, eventUids: [summonWindow.fireTarget.uid], previous: "graveyard", current: "monsterZone" },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: undefined, previous: undefined, current: undefined },
    ]);
    expect(summonWindow.restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const statWindow = createRestoredStatWindow({ reader, workspace });
    expectCleanRestore(statWindow.restored);
    expectRestoredLegalActions(statWindow.restored, 0);
    const statAction = getLuaRestoreLegalActions(statWindow.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === statWindow.revive.uid && action.effectId === "lua-2-1002"
    );
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(statWindow.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(statWindow.restored, statAction!);
    resolveRestoredChain(statWindow.restored);
    expect(statWindow.restored.session.state.cards.find((card) => card.uid === statWindow.revive.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: statWindow.revive.uid,
      reasonEffectId: 2,
    });
    expect(statWindow.restored.session.state.cards.find((card) => card.uid === statWindow.graveCopy.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: statWindow.revive.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(statWindow.restored.session.state.cards.find((card) => card.uid === statWindow.fieldSalamangreat.uid), statWindow.restored.session.state)).toBe(3000);
    expect(statWindow.restored.session.state.cards.find((card) => card.uid === statWindow.fieldSalamangreat.uid)).toMatchObject({
      attackModifier: 1500,
    });
    expect(statWindow.restored.session.state.eventHistory.filter((event) => ["becameTarget", "banished", "sentToDeck", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: statWindow.revive.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: statWindow.revive.uid, eventReasonEffectId: 2, eventUids: undefined, previous: "graveyard", current: "banished" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: statWindow.fieldSalamangreat.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: statWindow.graveCopy.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: undefined, previous: "deck", current: "graveyard" },
      { eventName: "sentToDeck", eventCode: 1013, eventCardUid: statWindow.graveCopy.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: statWindow.revive.uid, eventReasonEffectId: 2, eventUids: undefined, previous: "graveyard", current: "deck" },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: undefined, previous: undefined, current: undefined },
    ]);
    expect(statWindow.restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSummonWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): {
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  revive: DuelCardInstance;
  fireTarget: DuelCardInstance;
} {
  const session = createDuel({ seed: 19027895, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [reviveCode, fireTargetCode] }, 1: { main: [] } });
  startDuel(session);
  const revive = requireCard(session, reviveCode);
  const fireTarget = requireCard(session, fireTargetCode);
  moveFaceDownSpellTrap(session, revive, 0, 0);
  moveDuelCard(session.state, fireTarget.uid, "graveyard", 0).faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(reviveCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  return { restored, revive, fireTarget };
}

function createRestoredStatWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): {
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  revive: DuelCardInstance;
  fieldSalamangreat: DuelCardInstance;
  graveCopy: DuelCardInstance;
} {
  const session = createDuel({ seed: 19027896, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [reviveCode, salamangreatCode, salamangreatCode] }, 1: { main: [] } });
  startDuel(session);
  const revive = requireCard(session, reviveCode);
  const salamangreats = session.state.cards.filter((card) => card.code === salamangreatCode);
  expect(salamangreats).toHaveLength(2);
  const fieldSalamangreat = salamangreats[0]!;
  const graveCopy = salamangreats[1]!;
  moveDuelCard(session.state, revive.uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, fieldSalamangreat, 0, 0);
  moveDuelCard(session.state, graveCopy.uid, "graveyard", 0).faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(reviveCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  return { restored, revive, fieldSalamangreat, graveCopy };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Salamangreat Revive");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
  expect(script).toContain("Duel.IsExistingTarget(s.spfilter,tp,LOCATION_GRAVE,0,1,nil,e,tp)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TODECK+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_SALAMANGREAT)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil,tp)");
  expect(script).toContain("Duel.SelectTarget(tp,s.tdfilter,tp,LOCATION_GRAVE,0,1,1,nil,tc:GetFirst():GetCode())");
  expect(script).toContain("local g=Duel.GetTargetCards(e)");
  expect(script).toContain("g:Filter(Card.IsLocation,nil,LOCATION_GRAVE):GetFirst()");
  expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("atkc:UpdateAttack(atkc:GetBaseAttack(),RESETS_STANDARD_PHASE_END,e:GetHandler())");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const revive = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === reviveCode);
  expect(revive).toBeDefined();
  return [
    { ...revive!, kind: "trap", typeFlags: typeTrap, setcodes: [setSalamangreat] },
    { code: fireTargetCode, name: "Salamangreat Revive FIRE Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeFire, level: 4, attack: 1200, defense: 1000 },
    { code: salamangreatCode, name: "Salamangreat Revive Jack Jaguar", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setSalamangreat], race: raceCyberse, attribute: attributeFire, level: 4, attack: 1500, defense: 1000 },
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

function moveFaceDownSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = false;
  moved.position = "faceDown";
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
