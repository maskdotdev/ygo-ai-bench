import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, fusionSummonDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const meteorCode = "30086349";
const redEyesMaterialCode = "300863490";
const dragonMaterialCode = "300863491";
const deckRedEyesCode = "300863492";
const sendSpellCode = "300863493";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMeteorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${meteorCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceDragon = 0x2000;
const attributeDark = 0x20;
const setRedEyes = 0x3b;
const reasonFusionSummon = duelReason.summon | duelReason.specialSummon | duelReason.fusion;

describe.skipIf(!hasUpstreamScripts || !hasMeteorScript)("Lua real script Meteor Black Comet Dragon fusion mill revive", () => {
  it("restores Fusion.AddProcMix and summon Deck send damage while anchoring previous-MZONE grave revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${meteorCode}.lua`));
    const source = scriptSource(workspace);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 30086349, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [redEyesMaterialCode, dragonMaterialCode, deckRedEyesCode, sendSpellCode], extra: [meteorCode] },
      1: { main: [] },
    });
    startDuel(session);
    const meteor = requireCard(session, meteorCode);
    const redEyesMaterial = requireCard(session, redEyesMaterialCode);
    const dragonMaterial = requireCard(session, dragonMaterialCode);
    const deckRedEyes = requireCard(session, deckRedEyesCode);
    const sendSpell = requireCard(session, sendSpellCode);
    moveDuelCard(session.state, redEyesMaterial.uid, "hand", 0);
    moveDuelCard(session.state, dragonMaterial.uid, "hand", 0);
    moveDuelCard(session.state, sendSpell.uid, "spellTrapZone", 0).faceUp = false;
    sendSpell.position = "faceDown";
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(meteorCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(sendSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    fusionSummonDuelCard(session.state, 0, meteor.uid, [redEyesMaterial.uid, dragonMaterial.uid]);
    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(findCard(restoredOpen.session, meteor.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: [redEyesMaterial.uid, dragonMaterial.uid],
    });

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    expect(restoredSummonTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
    }))).toEqual([
      { effectId: "lua-3-1102", eventCardUid: meteor.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: reasonFusionSummon, player: 0, sourceUid: meteor.uid },
    ]);
    applyRestoredActionAndAssert(restoredSummonTrigger, requireAction(restoredSummonTrigger, meteor.uid, "activateTrigger"));
    resolveRestoredChain(restoredSummonTrigger);
    expect(findCard(restoredSummonTrigger.session, deckRedEyes.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: meteor.uid,
      reasonEffectId: 3,
    });
    expect(restoredSummonTrigger.session.state.players[1].lifePoints).toBe(6800);

    const restoredSend = restoreDuelWithLuaScripts(serializeDuel(restoredSummonTrigger.session), source, reader);
    expectCleanRestore(restoredSend);
    expectRestoredLegalActions(restoredSend, 0);
    applyRestoredActionAndAssert(restoredSend, requireAction(restoredSend, sendSpell.uid, "activateEffect"));
    expect(findCard(restoredSend.session, meteor.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: sendSpell.uid,
      reasonEffectId: 1,
    });
    const restoredAfterSend = restoreDuelWithLuaScripts(serializeDuel(restoredSend.session), source, reader);
    expectCleanRestore(restoredAfterSend);
    expectRestoredLegalActions(restoredAfterSend, 0);
    expect(restoredAfterSend.session.state.eventHistory.filter((event) => ["usedAsMaterial", "specialSummoned", "sentToGraveyard", "damageDealt"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: redEyesMaterial.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.material | duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "hand", current: "graveyard" },
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: redEyesMaterial.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: meteor.uid, eventReasonEffectId: undefined, previous: "hand", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: dragonMaterial.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.material | duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "hand", current: "graveyard" },
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: dragonMaterial.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.fusion, eventReasonPlayer: 0, eventReasonCardUid: meteor.uid, eventReasonEffectId: undefined, previous: "hand", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: meteor.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: reasonFusionSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: deckRedEyes.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: meteor.uid, eventReasonEffectId: 3, previous: "deck", current: "graveyard" },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 1, eventValue: 1200, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: meteor.uid, eventReasonEffectId: 3, previous: undefined, current: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: meteor.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: sendSpell.uid, eventReasonEffectId: 1, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: meteor.uid, eventPlayer: 0, eventValue: 0, eventUids: [meteor.uid], eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: sendSpell.uid, eventReasonEffectId: 1, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: sendSpell.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const meteor = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === meteorCode);
  expect(meteor).toBeDefined();
  return [
    {
      ...meteor!,
      fusionMaterialMin: 1,
      fusionMaterialMax: 1,
      fusionRequiredMaterialSetcodes: [setRedEyes],
      fusionMaterialRace: raceDragon,
      fusionMaterialLevel: 6,
    },
    redEyes(redEyesMaterialCode, "Meteor Red-Eyes Material", 2400),
    { code: dragonMaterialCode, name: "Meteor Level 6 Normal Dragon", kind: "monster", typeFlags: typeMonster, race: raceDragon, attribute: attributeDark, level: 6, attack: 2000, defense: 1600 },
    redEyes(deckRedEyesCode, "Meteor Deck Red-Eyes", 2400),
    { code: sendSpellCode, name: "Meteor Send Host Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function redEyes(code: string, name: string, attack: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 7, attack, defense: 2000, setcodes: [setRedEyes] };
}

function scriptSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${sendSpellCode}.lua`) return sendSpellScript();
      const script = workspace.readScript(name);
      if (script === undefined) throw new Error(`Missing script ${name}`);
      return script;
    },
  };
}

function sendSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingMatchingCard(Card.IsCode,tp,LOCATION_MZONE,0,1,nil,${meteorCode}) end
        local g=Duel.GetMatchingGroup(Card.IsCode,tp,LOCATION_MZONE,0,nil,${meteorCode})
        Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,1,tp,0)
      end)
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        local g=Duel.GetMatchingGroup(Card.IsCode,tp,LOCATION_MZONE,0,nil,${meteorCode})
        if Duel.SendtoGrave(g,REASON_EFFECT)>0 then
          Duel.RaiseEvent(g,EVENT_TO_GRAVE,e,REASON_EFFECT,tp,tp,0)
        end
      end)
      c:RegisterEffect(e)
    end
  `;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Meteor Black Comet Dragon");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,s.mfilter1,s.mfilter2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_DAMAGE+CATEGORY_DECKDES)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsFusionSummoned()");
  expect(script).toContain("return c:IsSetCard(SET_RED_EYES,fc,SUMMON_TYPE_FUSION,tp) and c:GetBaseAttack()>0 and c:IsAbleToGrave()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.damfilter,tp,LOCATION_HAND|LOCATION_DECK,0,1,1,nil,e:GetHandler(),tp)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
  expect(script).toContain("Duel.Damage(1-tp,math.ceil(g:GetFirst():GetBaseAttack()/2),REASON_EFFECT)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_MZONE)");
  expect(script).toContain("return c:IsType(TYPE_NORMAL) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
}

function requireCard(session: { state: { cards: DuelCardInstance[] } }, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: { state: { cards: DuelCardInstance[] } }, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
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
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventUids?: string[];
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventPlayer: event.eventPlayer,
    eventValue: event.eventValue,
    eventUids: event.eventUids,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
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
