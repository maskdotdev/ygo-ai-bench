import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { registerDuelFlagEffect } from "#duel/flags.js";
import { markProcedureComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const phoenixCode = "57134592";
const searchCode = "571345920";
const destroyedFireCode = "571345921";
const destroyerCode = "571345922";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPhoenixScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${phoenixCode}.lua`));
const salamangreatSanctuaryCode = 1295111;
const setSalamangreat = 0x119;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const attributeFire = 0x4;
const summonTypeLink = 0x4c000000;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPhoenixScript)("Lua real script Salamangreat Raging Phoenix reincarnation destroyed stat", () => {
  it("restores reincarnation Link Summon search and destroyed FIRE target self-summon ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${phoenixCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const source = sourceWithDestroyer(workspace);

    const restoredLink = createRestoredPhoenixField({ reader, source, workspace, scenario: "reincarnation" });
    expectCleanRestore(restoredLink);
    expectRestoredLegalActions(restoredLink, 0);
    const linkPhoenix = requireCard(restoredLink.session, phoenixCode);
    const searchTarget = requireCard(restoredLink.session, searchCode);
    registerDuelFlagEffect(restoredLink.session.state, { ownerType: "card", ownerId: linkPhoenix.uid }, salamangreatSanctuaryCode, 0, 0, 1);
    specialSummonDuelCard(restoredLink.session.state, linkPhoenix.uid, 0, 0, {}, summonTypeLink, true, false);
    expect(restoredLink.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1102", eventCardUid: linkPhoenix.uid, eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: linkPhoenix.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(restoredLink.session), source, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const searchTrigger = getLuaRestoreLegalActions(restoredSearch, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === linkPhoenix.uid
    );
    expect(searchTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, searchTrigger!);
    resolveRestoredChain(restoredSearch);

    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: linkPhoenix.uid,
      reasonEffectId: 4,
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
    }))).toEqual([
      { eventCardUid: linkPhoenix.uid, eventCode: 1102, eventName: "specialSummoned", eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: searchTarget.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: linkPhoenix.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
      { eventCardUid: searchTarget.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: linkPhoenix.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
      { eventCardUid: searchTarget.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: linkPhoenix.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
    ]);

    const restoredDestroyed = createRestoredPhoenixField({ reader, source, workspace, scenario: "destroyed" });
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    const gravePhoenix = requireCard(restoredDestroyed.session, phoenixCode);
    const destroyedFire = requireCard(restoredDestroyed.session, destroyedFireCode);
    const destroyer = requireCard(restoredDestroyed.session, destroyerCode);
    const destroyFire = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) =>
      action.type === "activateEffect" && action.uid === destroyer.uid
    );
    expect(destroyFire, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, destroyFire!);
    resolveRestoredChain(restoredDestroyed);

    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === destroyedFire.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: destroyer.uid,
      reasonEffectId: 1,
    });
    expect(restoredDestroyed.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-6-1029",
        sourceUid: gravePhoenix.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "destroyed",
        eventCode: 1029,
        eventPlayer: 0,
        eventCardUid: destroyedFire.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 1,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const destroyedTrigger = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === gravePhoenix.uid
    );
    expect(destroyedTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, destroyedTrigger!);
    resolveRestoredChain(restoredDestroyed);

    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === gravePhoenix.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: gravePhoenix.uid,
      reasonEffectId: 6,
    });
    expect(currentAttack(restoredDestroyed.session.state.cards.find((card) => card.uid === gravePhoenix.uid), restoredDestroyed.session.state)).toBe(4600);
    expect(restoredDestroyed.session.state.effects.filter((effect) => effect.sourceUid === gravePhoenix.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 33492992 }, sourceUid: gravePhoenix.uid, value: 1800 },
    ]);
    expect(restoredDestroyed.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "sentToGraveyard", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: destroyedFire.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 1 },
      { eventCardUid: destroyedFire.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: destroyer.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: destroyedFire.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: destroyer.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: destroyer.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: destroyedFire.uid, eventCode: 1028, eventName: "becameTarget", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: destroyer.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, relatedEffectId: 6 },
      { eventCardUid: gravePhoenix.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: gravePhoenix.uid, eventReasonEffectId: 6, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);
    expect(restoredDestroyed.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredPhoenixField({
  reader,
  source,
  workspace,
  scenario,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  scenario: "reincarnation" | "destroyed";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: scenario === "reincarnation" ? 57134592 : 57134593, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [searchCode, destroyedFireCode, destroyerCode], extra: [phoenixCode] }, 1: { main: [] } });
  startDuel(session);
  const phoenix = requireCard(session, phoenixCode);
  if (scenario === "destroyed") {
    const gravePhoenix = moveFaceUpGrave(session, phoenix, 0, 0);
    gravePhoenix.summonType = "link";
    markProcedureComplete(gravePhoenix);
    moveFaceUpAttack(session, requireCard(session, destroyedFireCode), 0, 0);
    moveDuelCard(session.state, requireCard(session, destroyerCode).uid, "hand", 0);
  }
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(phoenixCode), source).ok).toBe(true);
  if (scenario === "destroyed") expect(host.loadCardScript(Number(destroyerCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(scenario === "destroyed" ? 2 : 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Salamangreat Raging Phoenix");
  expect(script).toContain("aux.EnableCheckReincarnation(c)");
  expect(script).toContain("Link.AddProcedure(c,s.matfilter,2)");
  expect(script).toContain("return c:IsType(TYPE_EFFECT,scard,sumtype,tp) and c:IsAttribute(ATTRIBUTE_FIRE,scard,sumtype,tp)");
  expect(script).toContain("e1:SetCategory(CATEGORY_SEARCH+CATEGORY_TOHAND)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsReincarnationSummoned() and c:IsLinkSummoned()");
  expect(script).toContain("return c:IsSetCard(SET_SALAMANGREAT) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET,EFFECT_FLAG2_CHECK_SIMULTANEOUS)");
  expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("return c:IsReason(REASON_BATTLE|REASON_EFFECT) and (c:GetPreviousAttributeOnField()&ATTRIBUTE_FIRE)==ATTRIBUTE_FIRE");
  expect(script).toContain("not eg:IsContains(e:GetHandler()) and eg:IsExists(s.cfilter,1,nil,e,tp)");
  expect(script).toContain("Duel.SetTargetCard(tg)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,c,1,tp,tg:GetFirst():GetAttack())");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(tc:GetAttack())");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const phoenix = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === phoenixCode);
  expect(phoenix).toBeDefined();
  return [
    { ...phoenix!, kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeFire, attack: 2800, defense: 4, linkMarkers: 0x44, linkMaterialMin: 2 },
    { code: searchCode, name: "Raging Phoenix Salamangreat Search", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeFire, level: 4, attack: 1200, defense: 1000, setcodes: [setSalamangreat] },
    { code: destroyedFireCode, name: "Raging Phoenix Destroyed FIRE", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeFire, level: 4, attack: 1800, defense: 1000, setcodes: [setSalamangreat] },
    { code: destroyerCode, name: "Raging Phoenix Destroyer", kind: "spell", typeFlags: typeSpell },
  ];
}

function sourceWithDestroyer(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${destroyerCode}.lua`) return destroyerScript();
      return workspace.readScript(name);
    },
  };
}

function destroyerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
        if chkc then return chkc:IsControler(tp) and chkc:IsLocation(LOCATION_MZONE) end
        if chk==0 then return Duel.IsExistingTarget(Card.IsMonster,tp,LOCATION_MZONE,0,1,nil) end
        Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
        local g=Duel.SelectTarget(tp,Card.IsMonster,tp,LOCATION_MZONE,0,1,1,nil)
        Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)
      end)
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        local tc=Duel.GetFirstTarget()
        if tc and tc:IsRelateToEffect(e) then Duel.Destroy(tc,REASON_EFFECT) end
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

function moveFaceUpGrave(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "graveyard", player);
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
