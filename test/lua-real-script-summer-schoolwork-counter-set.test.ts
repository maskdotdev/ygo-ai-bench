import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const summerCode = "77751766";
const starterSpellCode = "777517660";
const extraMonsterCode = "777517661";
const schoolworkTrapCode = "777517662";
const deckPaddingCode = "777517663";
const counterSchoolwork = 0x213;
const setSchoolwork = 0x1a7;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Summer Schoolwork counter set", () => {
  it("restores spell-effect Extra Deck summon trigger into last counter removal, recover, destroy, and Schoolwork Trap set", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${summerCode}.lua`);
    expectScriptShape(script);

    const source = fixtureSource(workspace);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 77751766, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [summerCode, starterSpellCode, schoolworkTrapCode, deckPaddingCode], extra: [extraMonsterCode] }, 1: { main: [] } });
    startDuel(session);

    const summer = requireCard(session, summerCode);
    const starterSpell = requireCard(session, starterSpellCode);
    const extraMonster = requireCard(session, extraMonsterCode);
    const schoolworkTrap = requireCard(session, schoolworkTrapCode);
    moveFaceUpSpell(session, summer, 0);
    expect(addDuelCardCounter(summer, counterSchoolwork, 1)).toBe(true);
    moveDuelCard(session.state, starterSpell.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(summerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.filter((effect) => effect.sourceUid === summer.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
    }))).toEqual([
      { code: 0x10000 + counterSchoolwork, event: "continuous", range: ["spellTrapZone"] },
      { code: 1002, event: "quick", range: ["spellTrapZone"] },
      { code: 1102, event: "trigger", range: ["spellTrapZone"] },
      { code: 1014, event: "trigger", range: ["spellTrapZone"] },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const starter = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === starterSpell.uid);
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, starter!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === extraMonster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: starterSpell.uid,
      reasonEffectId: 5,
    });
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-3-1102",
        eventCardUid: extraMonster.uid,
        eventCode: 1102,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "specialSummoned",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonCardUid: starterSpell.uid,
        eventReasonEffectId: 5,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventUids: [extraMonster.uid],
        player: 0,
        sourceUid: summer.uid,
        triggerBucket: "turnMandatory",
      },
      {
        id: "trigger-6-2",
        effectId: "lua-4-1014",
        eventCardUid: starterSpell.uid,
        eventCode: 1014,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventName: "sentToGraveyard",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 1 },
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: summer.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === summer.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    expect(getDuelCardCounter(restoredTrigger.session.state.cards.find((card) => card.uid === summer.uid), counterSchoolwork)).toBe(0);
    expect(restoredTrigger.session.state.players[0].lifePoints).toBe(12000);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === summer.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: false,
      reason: duelReason.rule,
      reasonPlayer: 0,
      reasonCardUid: summer.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === schoolworkTrap.uid)).toMatchObject({ location: "deck" });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["counterRemoved", "breakEffect", "destroyed", "recoveredLifePoints", "set"].includes(event.eventName))).toEqual([
      {
        eventName: "counterRemoved",
        eventCode: 0x20000,
        eventCardUid: summer.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: summer.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: summer.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: summer.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: summer.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 0,
        eventValue: 4000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: summer.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: summer.uid,
        eventReasonEffectId: 3,
      },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === summerCode),
    { code: starterSpellCode, name: "Summer Schoolwork Starter Spell", kind: "spell", typeFlags: typeSpell },
    { code: extraMonsterCode, name: "Summer Schoolwork Extra Summon", kind: "extra", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: schoolworkTrapCode, name: "Summer Schoolwork Set Trap", kind: "trap", typeFlags: typeTrap, setcodes: [setSchoolwork] },
    { code: deckPaddingCode, name: "Summer Schoolwork Deck Padding", kind: "spell", typeFlags: typeSpell },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${starterSpellCode}.lua`) return starterSpellScript();
      return workspace.readScript(name);
    },
  };
}

function starterSpellScript(): string {
  return `
local s,id=GetID()
function s.initial_effect(c)
  local e=Effect.CreateEffect(c)
  e:SetType(EFFECT_TYPE_ACTIVATE)
  e:SetCode(EVENT_FREE_CHAIN)
  e:SetOperation(function(e,tp)
    local g=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,${extraMonsterCode}),tp,LOCATION_EXTRA,0,1,1,nil)
    local tc=g:GetFirst()
    if tc then Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_ATTACK) end
  end)
  c:RegisterEffect(e)
end
`;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("Summer Schoolwork Successful!");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SCHOOLWORK)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("c:AddCounter(COUNTER_SCHOOLWORK,5)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY+CATEGORY_RECOVER+CATEGORY_LEAVE_GRAVE+CATEGORY_SET)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("re and re:IsSpellTrapEffect() and eg:IsExists(Card.IsSummonLocation,1,nil,LOCATION_EXTRA)");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("re and re:IsSpellTrapEffect() and eg:IsExists(Card.IsPreviousLocation,1,nil,LOCATION_DECK)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,e:GetHandler(),1,0,0)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_RECOVER,nil,0,tp,4000)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_LEAVE_GRAVE,nil,1,tp,LOCATION_GRAVE)");
  expect(script).toContain("c:RemoveCounter(tp,COUNTER_SCHOOLWORK,1,REASON_EFFECT)");
  expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");
  expect(script).toContain("Duel.Recover(tp,4000,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.setfilter),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SSet(tp,sc)");
  expect(script).toContain("Duel.Win(tp,WIN_REASON_SUMMER_SCHOOLWORK)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
