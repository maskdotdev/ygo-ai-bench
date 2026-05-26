import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const breechCode = "90011273";
const searchCode = "900112730";
const targetDarkCode = "900112731";
const rokketCode = "900112732";
const responderCode = "900112733";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBreechScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${breechCode}.lua`));
const setRokket = 0x102;
const setBorrel = 0x10f;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceDragon = 0x2000;
const attributeDark = 0x20;
const summonTypeLink = 0x4c000000;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasBreechScript)("Lua real script Breechborrel link search quick attack Rokket stat", () => {
  it("restores Link Summon Borrel search, DARK target ATK gain, and lost-target Rokket fallback summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${breechCode}.lua`));
    const reader = createCardReader(cards(workspace));

    const restoredSearchOpen = createRestoredBreechField({ reader, source: workspace, workspace, scenario: "search" });
    expectCleanRestore(restoredSearchOpen);
    expectRestoredLegalActions(restoredSearchOpen, 0);
    const searchBreech = requireCard(restoredSearchOpen.session, breechCode);
    const searchTarget = requireCard(restoredSearchOpen.session, searchCode);
    specialSummonDuelCard(restoredSearchOpen.session.state, searchBreech.uid, 0, 0, {}, summonTypeLink, true, false);
    expect(restoredSearchOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1102", eventCardUid: searchBreech.uid, eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: searchBreech.uid, triggerBucket: "turnOptional" },
    ]);
    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(restoredSearchOpen.session), workspace, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const searchAction = getLuaRestoreLegalActions(restoredSearch, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === searchBreech.uid
    );
    expect(searchAction, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, searchAction!);
    resolveRestoredChain(restoredSearch);

    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: searchBreech.uid,
      reasonEffectId: 2,
    });
    expect(restoredSearch.host.messages).toContain(`confirmed 1: ${searchCode}`);
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: searchBreech.uid, eventCode: 1102, eventName: "specialSummoned", eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "extraDeck", current: "monsterZone" },
      { eventCardUid: searchTarget.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: searchBreech.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: searchTarget.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: searchBreech.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: searchTarget.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: searchBreech.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "deck", current: "hand" },
    ]);

    const restoredBoost = createRestoredBreechField({ reader, source: workspace, workspace, scenario: "boost" });
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    const boostBreech = requireCard(restoredBoost.session, breechCode);
    const boostTarget = requireCard(restoredBoost.session, targetDarkCode);
    const boostAction = getLuaRestoreLegalActions(restoredBoost, 0).find((action) =>
      action.type === "activateEffect" && action.uid === boostBreech.uid
    );
    expect(boostAction, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    expect(boostAction).toMatchObject({ effectId: "lua-3-1002", player: 0, uid: boostBreech.uid });
    applyRestoredActionAndAssert(restoredBoost, boostAction!);
    resolveRestoredChain(restoredBoost);

    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === boostTarget.uid), restoredBoost.session.state)).toBe((boostTarget.data.attack ?? 0) + 500);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.sourceUid === boostTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: 0x400, reset: { flags: 33427456 }, sourceUid: boostTarget.uid, value: 500 },
    ]);

    const source = sourceWithResponder(workspace);
    const restoredFallback = createRestoredBreechField({ reader, source, workspace, scenario: "fallback" });
    expectCleanRestore(restoredFallback);
    expectRestoredLegalActions(restoredFallback, 0);
    const fallbackBreech = requireCard(restoredFallback.session, breechCode);
    const fallbackTarget = requireCard(restoredFallback.session, targetDarkCode);
    const rokket = requireCard(restoredFallback.session, rokketCode);
    const responder = requireCard(restoredFallback.session, responderCode);
    const fallbackAction = getLuaRestoreLegalActions(restoredFallback, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fallbackBreech.uid
    );
    expect(fallbackAction, JSON.stringify(getLuaRestoreLegalActions(restoredFallback, 0), null, 2)).toBeDefined();
    expect(fallbackAction).toMatchObject({ effectId: "lua-3-1002", player: 0, uid: fallbackBreech.uid });
    applyRestoredActionAndAssert(restoredFallback, fallbackAction!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredFallback.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 1);
    const removeTarget = getLuaRestoreLegalActions(restoredResponse, 1).find((action) =>
      action.type === "activateEffect" && action.uid === responder.uid
    );
    expect(removeTarget, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, removeTarget!);
    resolveRestoredChain(restoredResponse);

    expect(restoredResponse.host.messages).toContain("breechborrel target remover resolved");
    expect(restoredResponse.session.state.cards.find((card) => card.uid === fallbackTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 1,
      reasonCardUid: responder.uid,
      reasonEffectId: 4,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === rokket.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: fallbackBreech.uid,
      reasonEffectId: 3,
    });
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard", "specialSummoned", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventChainDepth: event.eventChainDepth,
      eventChainLinkId: event.eventChainLinkId,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: fallbackTarget.uid, eventChainDepth: 1, eventChainLinkId: "chain-2", eventCode: 1028, eventName: "becameTarget", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "monsterZone", relatedEffectId: 3 },
      { eventCardUid: fallbackTarget.uid, eventChainDepth: 2, eventChainLinkId: "chain-3", eventCode: 1028, eventName: "becameTarget", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "deck", current: "monsterZone", relatedEffectId: 4 },
      { eventCardUid: fallbackTarget.uid, eventChainDepth: undefined, eventChainLinkId: undefined, eventCode: 1014, eventName: "sentToGraveyard", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: responder.uid, eventReasonEffectId: 4, eventReasonPlayer: 1, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: undefined, eventChainDepth: 2, eventChainLinkId: "chain-3", eventCode: 1022, eventName: "chainSolved", eventPlayer: 1, eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: undefined, current: undefined, relatedEffectId: 4 },
      { eventCardUid: rokket.uid, eventChainDepth: undefined, eventChainLinkId: undefined, eventCode: 1102, eventName: "specialSummoned", eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: fallbackBreech.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "deck", current: "monsterZone", relatedEffectId: undefined },
      { eventCardUid: undefined, eventChainDepth: 1, eventChainLinkId: "chain-2", eventCode: 1022, eventName: "chainSolved", eventPlayer: 0, eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: undefined, current: undefined, relatedEffectId: 3 },
    ]);
    expect(restoredResponse.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredBreechField({
  reader,
  source,
  workspace,
  scenario,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  scenario: "search" | "boost" | "fallback";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: scenario === "search" ? 90011273 : scenario === "boost" ? 90011274 : 90011275, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  const playerMain = scenario === "search" ? [searchCode] : [targetDarkCode, rokketCode];
  const opponentMain = scenario === "fallback" ? [responderCode] : [];
  loadDecks(session, { 0: { main: playerMain, extra: [breechCode] }, 1: { main: opponentMain } });
  startDuel(session);
  const breech = requireCard(session, breechCode);
  if (scenario !== "search") {
    moveFaceUpAttack(session, requireCard(session, targetDarkCode), 0, 0);
    moveFaceUpAttack(session, breech, 0, 1);
    if (scenario === "fallback") moveDuelCard(session.state, requireCard(session, responderCode).uid, "hand", 1);
  }
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(breechCode), source).ok).toBe(true);
  if (scenario === "fallback") expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(scenario === "fallback" ? 2 : 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Breechborrel Dragon");
  expect(script).toContain("Link.AddProcedure(c,s.matfilter,2,nil,s.matcheck)");
  expect(script).toContain("return g:IsExists(Card.IsSetCard,1,nil,SET_ROKKET,linkc,sumtype,tp)");
  expect(script).toContain("s.listed_series={SET_BORREL,SET_ROKKET}");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsLinkSummoned()");
  expect(script).toContain("return c:IsSetCard(SET_BORREL) and c:IsSpellTrap() and c:IsAbleToHand()");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e2:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsAttribute,ATTRIBUTE_DARK),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("return c:IsSetCard(SET_ROKKET) and c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
}

function cards(_workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    { code: breechCode, name: "Breechborrel Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceDragon, attribute: attributeDark, level: 4, attack: 2800, defense: 0, linkMarkers: 0x45, linkMaterialMin: 2 },
    { code: searchCode, name: "Breechborrel Borrel Search", kind: "spell", typeFlags: typeSpell, setcodes: [setBorrel] },
    { code: targetDarkCode, name: "Breechborrel DARK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
    { code: rokketCode, name: "Breechborrel Rokket Deck Summon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1400, defense: 1700, setcodes: [setRokket] },
    { code: responderCode, name: "Breechborrel Target Remover", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function sourceWithResponder(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return responderScript();
      return workspace.readScript(name);
    },
  };
}

function responderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingTarget(Card.IsCode,tp,0,LOCATION_MZONE,1,nil,${targetDarkCode}) end
        Duel.SelectTarget(tp,Card.IsCode,tp,0,LOCATION_MZONE,1,1,nil,${targetDarkCode})
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstTarget()
        if tc and tc:IsRelateToEffect(e) then Duel.SendtoGrave(tc,REASON_EFFECT) end
        Debug.Message("breechborrel target remover resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
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
