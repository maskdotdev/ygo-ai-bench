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
const ersteCode = "66809920";
const mischiefCode = "92182447";
const summonSpellCode = "668099200";
const valkyrieAllyCode = "668099201";
const opponentGraveCode = "668099202";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasErsteScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ersteCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceFairy = 0x4;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const setValkyrie = 0x122;
const effectSetAttack = 101;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasErsteScript)("Lua real script Valkyrie Erste summon search grave banish set attack", () => {
  it("restores spell Special Summon search and Valkyrie-gated grave banish ATK setting", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${ersteCode}.lua`));
    const source = sourceWithSummonSpell(workspace);
    const reader = createCardReader(cards(workspace));

    const restoredSummonOpen = createRestoredSpellSummon({ reader, source, workspace });
    expectCleanRestore(restoredSummonOpen);
    expectRestoredLegalActions(restoredSummonOpen, 0);
    const summonSpell = requireCard(restoredSummonOpen.session, summonSpellCode);
    const summonErste = requireCard(restoredSummonOpen.session, ersteCode);
    const mischief = requireCard(restoredSummonOpen.session, mischiefCode);
    const spellAction = getLuaRestoreLegalActions(restoredSummonOpen, 0).find((action) => action.type === "activateEffect" && action.uid === summonSpell.uid);
    expect(spellAction, JSON.stringify(getLuaRestoreLegalActions(restoredSummonOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonOpen, spellAction!);
    resolveRestoredChain(restoredSummonOpen);

    expect(restoredSummonOpen.session.state.cards.find((card) => card.uid === summonErste.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      previousLocation: "hand",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonSpell.uid,
      reasonEffectId: 3,
    });
    expect(restoredSummonOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-1-1102",
        eventCardUid: summonErste.uid,
        eventCode: 1102,
        eventName: "specialSummoned",
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonCardUid: summonSpell.uid,
        eventReasonEffectId: 3,
        player: 0,
        sourceUid: summonErste.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredSearchTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummonOpen.session), source, reader);
    expectCleanRestore(restoredSearchTrigger);
    expectRestoredLegalActions(restoredSearchTrigger, 0);
    const searchAction = getLuaRestoreLegalActions(restoredSearchTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === summonErste.uid);
    expect(searchAction, JSON.stringify(getLuaRestoreLegalActions(restoredSearchTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearchTrigger, searchAction!);
    resolveRestoredChain(restoredSearchTrigger);

    expect(restoredSearchTrigger.session.state.cards.find((card) => card.uid === mischief.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summonErste.uid,
      reasonEffectId: 1,
    });
    expect(restoredSearchTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget", "sentToHand"].includes(event.eventName)).map((event) => ({
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
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: summonErste.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: summonSpell.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: mischief.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previous: "deck", current: "graveyard" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: mischief.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: summonErste.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "graveyard", current: "hand" },
    ]);

    const restoredQuickOpen = createRestoredQuickBanish({ reader, source, workspace });
    expectCleanRestore(restoredQuickOpen);
    expectRestoredLegalActions(restoredQuickOpen, 0);
    const quickErste = requireCard(restoredQuickOpen.session, ersteCode);
    const opponentGrave = requireCard(restoredQuickOpen.session, opponentGraveCode);
    const quickAction = getLuaRestoreLegalActions(restoredQuickOpen, 0).find((action) => action.type === "activateEffect" && action.uid === quickErste.uid);
    expect(quickAction, JSON.stringify(getLuaRestoreLegalActions(restoredQuickOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuickOpen, quickAction!);
    resolveRestoredChain(restoredQuickOpen);

    expect(restoredQuickOpen.session.state.cards.find((card) => card.uid === opponentGrave.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: quickErste.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredQuickOpen.session.state.cards.find((card) => card.uid === quickErste.uid), restoredQuickOpen.session.state)).toBe(2600);
    expect(restoredQuickOpen.session.state.effects.filter((effect) => effect.sourceUid === quickErste.uid && effect.code === effectSetAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttack, reset: { flags: 1107235328 }, sourceUid: quickErste.uid, value: 2600 },
    ]);
    expect(restoredQuickOpen.session.state.eventHistory.filter((event) => event.eventName === "banished" || event.eventName === "breakEffect").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentGrave.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: quickErste.uid, eventReasonEffectId: 2, previous: "graveyard", current: "banished" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: quickErste.uid, eventReasonEffectId: 2, previous: undefined, current: undefined },
    ]);
    expect(restoredQuickOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSpellSummon({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ReturnType<typeof sourceWithSummonSpell>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 66809920, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ersteCode, summonSpellCode, mischiefCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, ersteCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, summonSpellCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, mischiefCode).uid, "graveyard", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  registerScripts(session, source, workspace, true);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredQuickBanish({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ReturnType<typeof sourceWithSummonSpell>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 66809921, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ersteCode, valkyrieAllyCode] }, 1: { main: [opponentGraveCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, ersteCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, valkyrieAllyCode), 0, 1);
  moveDuelCard(session.state, requireCard(session, opponentGraveCode).uid, "graveyard", 1).faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  registerScripts(session, source, workspace, false);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function registerScripts(
  session: DuelSession,
  source: ReturnType<typeof sourceWithSummonSpell>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  includeSpell: boolean,
): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ersteCode), source).ok).toBe(true);
  if (includeSpell) expect(host.loadCardScript(Number(summonSpellCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(includeSpell ? 2 : 1);
}

function sourceWithSummonSpell(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string): string | undefined {
      if (name === `c${summonSpellCode}.lua`) return summonSpellScript();
      return workspace.readScript(name);
    },
  };
}

function summonSpellScript(): string {
  return `
local s,id=GetID()
function s.initial_effect(c)
  local e1=Effect.CreateEffect(c)
  e1:SetCategory(CATEGORY_SPECIAL_SUMMON)
  e1:SetType(EFFECT_TYPE_ACTIVATE)
  e1:SetCode(EVENT_FREE_CHAIN)
  e1:SetTarget(s.target)
  e1:SetOperation(s.operation)
  c:RegisterEffect(e1)
end
function s.filter(c,e,tp)
  return c:IsCode(${ersteCode}) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
  if chk==0 then return Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_HAND,0,1,nil,e,tp) end
  Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
  Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
  local g=Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_HAND,0,1,1,nil,e,tp)
  if #g>0 then
    Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)
  end
end
`;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Valkyrie Erste");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("re and re:IsSpellEffect() and e:GetHandler():IsSummonLocation(LOCATION_HAND)");
  expect(script).toContain("return c:IsCode(92182447) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
  expect(script).toContain("e2:SetCategory(CATEGORY_REMOVE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e2:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("return Duel.IsExistingMatchingCard(s.rmconfilter,tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.rmfilter,tp,0,LOCATION_GRAVE,1,1,nil)");
  expect(script).toContain("Duel.Remove(sc,POS_FACEUP,REASON_EFFECT)>0");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK)");
  expect(script).toContain("e1:SetValue(sc:GetBaseAttack())");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const databaseCards = workspace.readDatabaseCards("cards.cdb");
  const erste = databaseCards.find((card) => card.code === ersteCode);
  const mischief = databaseCards.find((card) => card.code === mischiefCode);
  expect(erste).toBeDefined();
  expect(mischief).toBeDefined();
  return [
    erste!,
    mischief!,
    { code: summonSpellCode, name: "Valkyrie Erste Spell Summon Fixture", kind: "spell", typeFlags: typeSpell },
    { code: valkyrieAllyCode, name: "Valkyrie Erste Ally Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setValkyrie], race: raceFairy, attribute: attributeLight, level: 4, attack: 1400, defense: 1000 },
    { code: opponentGraveCode, name: "Valkyrie Erste Opponent Grave ATK Source", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2600, defense: 1000 },
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
