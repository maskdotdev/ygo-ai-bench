import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const blueAbyssCode = "67886895";
const lightTunerCode = "678868950";
const blueEyesWhiteDragonCode = "89631139";
const graveSenderCode = "678868951";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBlueAbyssScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${blueAbyssCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const raceDragon = 0x2000;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const effectSetAttackFinal = 102;
const effectLeaveFieldRedirect = 60;
const eventCustomBlueAbyss = 0x10000000 + Number(blueAbyssCode);

describe.skipIf(!hasUpstreamScripts || !hasBlueAbyssScript)("Lua real script Deep-Eyes Blue Abyss search global revive stat", () => {
  it("restores self-discard search and global Blue-Eyes to-grave custom revive with final ATK redirect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${blueAbyssCode}.lua`);
    expectBlueAbyssScriptShape(script);

    const { reader, source, restoredOpen } = createRestoredOpen(workspace);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const blueAbyss = requireCard(restoredOpen.session, blueAbyssCode);
    const lightTuner = requireCard(restoredOpen.session, lightTunerCode);
    const blueEyes = requireCard(restoredOpen.session, blueEyesWhiteDragonCode);
    const graveSender = requireCard(restoredOpen.session, graveSenderCode);

    const search = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === blueAbyss.uid);
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, search!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === blueAbyss.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: blueAbyss.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === lightTuner.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: blueAbyss.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToGraveyard", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: blueAbyss.uid, eventPlayer: undefined, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: blueAbyss.uid, eventReasonEffectId: 1, previous: "hand", current: "graveyard" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: lightTuner.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: blueAbyss.uid, eventReasonEffectId: 1, previous: "deck", current: "hand" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: lightTuner.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: blueAbyss.uid, eventReasonEffectId: 1, previous: "deck", current: "hand" },
      { eventName: "sentToHandConfirmed", eventCode: 1212, eventCardUid: lightTuner.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: blueAbyss.uid, eventReasonEffectId: 1, previous: "deck", current: "hand" },
    ]);

    const restoredAfterSearch = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredAfterSearch);
    expectRestoredLegalActions(restoredAfterSearch, 0);
    const sendBlueEyes = getLuaRestoreLegalActions(restoredAfterSearch, 0).find((action) => action.type === "activateEffect" && action.uid === graveSender.uid);
    expect(sendBlueEyes, JSON.stringify(getLuaRestoreLegalActions(restoredAfterSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAfterSearch, sendBlueEyes!);
    resolveRestoredChain(restoredAfterSearch);

    expect(restoredAfterSearch.session.state.cards.find((card) => card.uid === blueEyes.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveSender.uid,
      reasonEffectId: 4,
    });
    expect(restoredAfterSearch.session.state.pendingTriggers.map((trigger) => ({
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
        effectId: "lua-2-336322351",
        eventCardUid: blueEyes.uid,
        eventCode: eventCustomBlueAbyss,
        eventName: "customEvent",
        eventReason: 0,
        eventReasonCardUid: blueAbyss.uid,
        eventReasonEffectId: 3,
        player: 0,
        sourceUid: blueAbyss.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredAfterSearch.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const revive = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === blueAbyss.uid);
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, revive!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === blueAbyss.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: blueAbyss.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === blueAbyss.uid), restoredTrigger.session.state)).toBe(3000);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === blueAbyss.uid && [effectSetAttackFinal, effectLeaveFieldRedirect].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: undefined, reset: { flags: 33492992 }, value: 3000 },
      { code: effectLeaveFieldRedirect, property: 0x400 | 0x4000000, reset: { flags: 209326080 }, value: 0x20 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "customEvent", "becameTarget", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: blueAbyss.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: blueAbyss.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "hand", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: blueEyes.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: graveSender.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "customEvent", eventCode: eventCustomBlueAbyss, eventCardUid: blueEyes.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: blueAbyss.uid, eventReasonEffectId: 3, relatedEffectId: 3, previous: "monsterZone", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: blueEyes.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: graveSender.uid, eventReasonEffectId: 4, relatedEffectId: 2, previous: "monsterZone", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: blueAbyss.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: blueAbyss.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "graveyard", current: "monsterZone" },
    ]);

    const restoredRedirect = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredRedirect);
    expectRestoredLegalActions(restoredRedirect, 0);
    destroyDuelCard(restoredRedirect.session.state, blueAbyss.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredRedirect.session.state.cards.find((card) => card.uid === blueAbyss.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy | duelReason.redirect,
      reasonPlayer: 0,
    });
    expect(restoredRedirect.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredOpen(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  restoredOpen: ReturnType<typeof restoreDuelWithLuaScripts>;
} {
  const reader = createCardReader(cards());
  const session = createDuel({ seed: 67886895, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [blueAbyssCode, lightTunerCode, blueEyesWhiteDragonCode, graveSenderCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, blueAbyssCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, blueEyesWhiteDragonCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, graveSenderCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const source = {
    readScript(name: string) {
      if (name === `c${graveSenderCode}.lua`) return graveSenderScript();
      return workspace.readScript(name);
    },
  };
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(blueAbyssCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(graveSenderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return { reader, source, restoredOpen: restoreDuelWithLuaScripts(serializeDuel(session), source, reader) };
}

function expectBlueAbyssScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("e1:SetCost(Cost.SelfDiscard)");
  expect(script).toContain("return c:IsLevel(1) and c:IsAttribute(ATTRIBUTE_LIGHT) and c:IsType(TYPE_TUNER) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE+CATEGORY_REMOVE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetCode(EVENT_CUSTOM+id)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE|LOCATION_HAND)");
  expect(script).toContain("aux.GlobalCheck(s,function()");
  expect(script).toContain("ge1:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("Duel.RegisterEffect(ge1,0)");
  expect(script).toContain("Duel.RaiseEvent(s.gygroup,EVENT_CUSTOM+id,e,0,rp,ep,ev)");
  expect(script).toContain("Duel.SetTargetCard(tc)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack())");
  expect(script).toContain("e2:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
}

function graveSenderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        local g=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,${blueEyesWhiteDragonCode}),tp,LOCATION_MZONE,0,1,1,nil)
        Duel.SendtoGrave(g,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
}

function cards(): DuelCardData[] {
  return [
    { code: blueAbyssCode, name: "Deep-Eyes White Dragon, the Blue Abyss", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 10, attack: 0, defense: 0 },
    { code: lightTunerCode, name: "Blue Abyss LIGHT Tuner Search Target", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceSpellcaster, attribute: attributeLight, level: 1, attack: 500, defense: 500 },
    { code: blueEyesWhiteDragonCode, name: "Blue-Eyes White Dragon", kind: "monster", typeFlags: typeMonster, race: raceDragon, attribute: attributeLight, level: 8, attack: 3000, defense: 2500 },
    { code: graveSenderCode, name: "Blue Abyss Grave Sender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
