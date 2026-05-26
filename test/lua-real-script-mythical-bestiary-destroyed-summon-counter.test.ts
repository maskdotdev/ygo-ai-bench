import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const bestiaryCode = "38325384";
const deckSpellCounterCode = "383253840";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBestiaryScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bestiaryCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeQuickPlay = 0x10000;
const counterSpell = 0x1;
const eventDestroyed = 1029;
const eventSentToGraveyard = 1014;
const eventSpecialSummoned = 1102;
const chooseTwoCounters = [{ api: "SelectOption" as const, player: 0 as const, returned: 1 }];

describe.skipIf(!hasUpstreamScripts || !hasBestiaryScript)("Lua real script Mythical Bestiary destroyed summon counter", () => {
  it("restores opponent-effect destruction, deck summon, SelectOption, and Spell Counter placement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectBestiaryScriptShape(workspace.readScript(`official/c${bestiaryCode}.lua`));
    const source = {
      readScript(name: string) {
        if (name === `c${deckSpellCounterCode}.lua`) return spellCounterDeckMonsterScript();
        return workspace.readScript(name);
      },
    };
    const reader = createCardReader(cards());
    const session = setupDuel(reader);
    const bestiary = requireCard(session, bestiaryCode);
    const deckTarget = requireCard(session, deckSpellCounterCode);
    moveDuelCard(session.state, bestiary.uid, "spellTrapZone", 0).faceUp = true;
    registerScripts(session, source);
    destroyDuelCard(session.state, bestiary.uid, 0, duelReason.effect | duelReason.destroy, 1);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, { promptOverrides: chooseTwoCounters });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === bestiary.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
    });
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-2-1029", eventCardUid: bestiary.uid, eventCode: eventDestroyed, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, player: 0, sourceUid: bestiary.uid, triggerBucket: "turnOptional" },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === bestiary.uid && action.effectId === "lua-2-1029",
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    const summonedTarget = findCard(restoredTrigger.session, deckTarget.uid);
    expect(summonedTarget).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: bestiary.uid,
      reasonEffectId: 2,
    });
    expect(getDuelCardCounter(findCard(restoredTrigger.session, deckTarget.uid), counterSpell)).toBe(2);
    expect(restoredTrigger.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectOption", player: 0, descriptions: [613206144, 613206145], options: [0, 1], returned: 1 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard", "specialSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
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
      { eventName: "destroyed", eventCode: eventDestroyed, eventCardUid: bestiary.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: eventSentToGraveyard, eventCardUid: bestiary.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: eventSpecialSummoned, eventCardUid: deckTarget.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: bestiary.uid, eventReasonEffectId: 2, previous: "deck", current: "monsterZone" },
      { eventName: "counterAdded", eventCode: 65536, eventCardUid: deckTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: bestiary.uid, eventReasonEffectId: 2, previous: "deck", current: "monsterZone" },
    ]);
  });
});

function setupDuel(reader: ReturnType<typeof createCardReader>): DuelSession {
  const session = createDuel({ seed: 38325384, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [bestiaryCode, deckSpellCounterCode] }, 1: { main: [] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerScripts(session: DuelSession, source: { readScript(name: string): string | undefined }): void {
  const host = createLuaScriptHost(session, source);
  expect(host.loadCardScript(Number(bestiaryCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(deckSpellCounterCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
}

function spellCounterDeckMonsterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      c:EnableCounterPermit(COUNTER_SPELL,LOCATION_MZONE)
    end
  `;
}

function expectBestiaryScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Mythical Bestiary");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("Duel.IsPlayerCanDiscardDeckAsCost(tp,2)");
  expect(script).toContain("Duel.DiscardDeck(tp,2,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_SPELL)");
  expect(script).toContain("local tc=Duel.GetFirstTarget()");
  expect(script).toContain("Duel.SelectOption(tp,aux.Stringid(id,0),aux.Stringid(id,1))");
  expect(script).toContain("tc:AddCounter(COUNTER_SPELL,scn+1)");
  expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("return rp~=tp and c:IsReason(REASON_EFFECT) and c:IsPreviousControler(tp)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_DECK,0,1,nil,e,tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp):GetFirst()");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)~=0");
}

function cards(): DuelCardData[] {
  return [
    { code: bestiaryCode, name: "Mythical Bestiary", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
    { code: deckSpellCounterCode, name: "Mythical Bestiary Deck Counter Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1200 },
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
}
