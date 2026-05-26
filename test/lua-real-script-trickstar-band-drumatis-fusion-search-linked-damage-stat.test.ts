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
const drumatisCode = "64804137";
const materialACode = "648041370";
const materialBCode = "648041371";
const searchTargetCode = "648041372";
const linkedTrickstarCode = "648041373";
const unlinkedTrickstarCode = "648041374";
const burnSpellCode = "648041375";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDrumatisScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${drumatisCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceFairy = 0x4;
const attributeLight = 0x10;
const setTrickstar = 0xfb;
const effectUpdateAttack = 100;
const effectSetAttackFinal = 102;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDrumatisScript)("Lua real script Trickstar Band Drumatis fusion search linked damage stat", () => {
  it("restores Trickstar Fusion summon search, linked Link ATK aura, and effect-damage target ATK zero", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectDrumatisScriptShape(workspace.readScript(`official/c${drumatisCode}.lua`));
    const drumatisData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === drumatisCode);
    expect(drumatisData).toBeDefined();
    const reader = createCardReader([
      drumatisData!,
      ...fixtureCards(),
    ]);

    const restoredFusion = createRestoredFusionWindow({ reader, workspace });
    expectCleanRestore(restoredFusion);
    expectRestoredLegalActions(restoredFusion, 0);
    const drumatis = requireCard(restoredFusion.session, drumatisCode);
    const materialA = requireCard(restoredFusion.session, materialACode);
    const materialB = requireCard(restoredFusion.session, materialBCode);
    const searchTarget = requireCard(restoredFusion.session, searchTargetCode);
    const linkedTrickstar = requireCard(restoredFusion.session, linkedTrickstarCode);
    const unlinkedTrickstar = requireCard(restoredFusion.session, unlinkedTrickstarCode);
    const fusionSummon = getLuaRestoreLegalActions(restoredFusion, 0).find((action): action is Extract<DuelAction, { type: "fusionSummon" }> =>
      action.type === "fusionSummon" && action.uid === drumatis.uid && sameMembers(action.materialUids, [materialA.uid, materialB.uid])
    );
    expect(fusionSummon, JSON.stringify(getLuaRestoreLegalActions(restoredFusion, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFusion, fusionSummon!);
    const summonedDrumatis = restoredFusion.session.state.cards.find((card) => card.uid === drumatis.uid);
    expect(summonedDrumatis).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "fusion",
      summonMaterialUids: [materialA.uid, materialB.uid],
    });
    expect(restoredFusion.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.material | duelReason.fusion,
      reasonPlayer: 0,
    });
    expect(restoredFusion.session.state.cards.find((card) => card.uid === materialB.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.material | duelReason.fusion,
      reasonPlayer: 0,
    });

    summonedDrumatis!.sequence = 2;
    expect(currentAttack(restoredFusion.session.state.cards.find((card) => card.uid === linkedTrickstar.uid), restoredFusion.session.state)).toBe(2400);
    expect(currentAttack(restoredFusion.session.state.cards.find((card) => card.uid === unlinkedTrickstar.uid), restoredFusion.session.state)).toBe(1300);
    expect(restoredFusion.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredFusion.session.state.effects.filter((effect) => effect.sourceUid === drumatis.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, range: ["monsterZone"], sourceUid: drumatis.uid, targetRange: [4, 0], value: 1000 },
    ]);

    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(restoredFusion.session), workspace, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const search = getLuaRestoreLegalActions(restoredSearch, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === drumatis.uid && action.effectId === "lua-3-1102",
    );
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    expect(("operationInfos" in search! ? search!.operationInfos : []) ?? []).toEqual([]);
    applyRestoredActionAndAssert(restoredSearch, search!);
    resolveRestoredChain(restoredSearch);
    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: drumatis.uid,
      reasonEffectId: 3,
    });
    const materialCopy = restoredSearch.session.state.cards.find((card) => card.code === materialACode && card.location === "deck");
    expect(materialCopy).toBeDefined();
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed", "chainSolved"].includes(event.eventName))).toEqual([
      sentToHandEvent(searchTarget.uid, drumatis.uid, 3, 5),
      confirmedEvent(searchTarget.uid, drumatis.uid, 3, 5),
      sentToHandConfirmedEvent(searchTarget.uid, drumatis.uid, 3, 5),
      chainSolvedEvent(3, "chain-7"),
    ]);

    const restoredDamage = createRestoredDamageWindow({ reader, workspace });
    expectCleanRestore(restoredDamage);
    expectRestoredLegalActions(restoredDamage, 0);
    const damageDrumatis = requireCard(restoredDamage.session, drumatisCode);
    const burnSpell = requireCard(restoredDamage.session, burnSpellCode);
    const burn = getLuaRestoreLegalActions(restoredDamage, 0).find((action) => action.type === "activateEffect" && action.uid === burnSpell.uid);
    expect(burn, JSON.stringify(getLuaRestoreLegalActions(restoredDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamage, burn!);
    resolveRestoredChain(restoredDamage);
    expect(restoredDamage.session.state.players[1].lifePoints).toBe(7600);
    expect(restoredDamage.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventPlayer: trigger.eventPlayer,
      eventValue: trigger.eventValue,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-5-1111", eventName: "damageDealt", eventCode: 1111, eventPlayer: 1, eventValue: 400, eventReason: duelReason.effect, eventReasonCardUid: burnSpell.uid, eventReasonEffectId: 1, player: 0, sourceUid: damageDrumatis.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredDamageTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDamage.session), sourceWithBurn(workspace), reader);
    expectCleanRestore(restoredDamageTrigger);
    expectRestoredLegalActions(restoredDamageTrigger, 0);
    const zero = getLuaRestoreLegalActions(restoredDamageTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === damageDrumatis.uid && action.effectId === "lua-5-1111");
    expect(zero, JSON.stringify(getLuaRestoreLegalActions(restoredDamageTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamageTrigger, zero!);
    resolveRestoredChain(restoredDamageTrigger);
    expect(currentAttack(restoredDamageTrigger.session.state.cards.find((card) => card.uid === damageDrumatis.uid), restoredDamageTrigger.session.state)).toBe(0);
    expect(restoredDamageTrigger.session.state.effects.filter((effect) => effect.sourceUid === damageDrumatis.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: 1024, reset: { flags: resetEventStandard }, sourceUid: damageDrumatis.uid, value: 0 },
    ]);
    expect(restoredDamageTrigger.session.state.eventHistory.filter((event) => ["damageDealt", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 400,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: burnSpell.uid,
        eventReasonEffectId: 1,
      },
      chainSolvedEvent(1, "chain-2"),
      chainSolvedEvent(5, "chain-6"),
    ]);
  });
});

function createRestoredFusionWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 64804137, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [materialACode, materialBCode, searchTargetCode, materialACode, linkedTrickstarCode, unlinkedTrickstarCode], extra: [drumatisCode] },
    1: { main: [] },
  });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, materialACode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, materialBCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, linkedTrickstarCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, unlinkedTrickstarCode), 0, 4);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(drumatisCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDamageWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 64804138, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [burnSpellCode], extra: [drumatisCode] }, 1: { main: [] } });
  startDuel(session);
  const drumatis = moveFaceUpAttack(session, requireCard(session, drumatisCode), 0, 0);
  drumatis.summonType = "fusion";
  moveDuelCard(session.state, requireCard(session, burnSpellCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const source = sourceWithBurn(workspace);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(drumatisCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(burnSpellCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function sourceWithBurn(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${burnSpellCode}.lua`) return burnSpellScript();
      return workspace.readScript(name);
    },
  };
}

function fixtureCards(): DuelCardData[] {
  return [
    { code: materialACode, name: "Drumatis Trickstar Material A", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setTrickstar], race: raceFairy, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Drumatis Trickstar Material B", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setTrickstar], race: raceFairy, attribute: attributeLight, level: 4, attack: 1100, defense: 1000 },
    { code: searchTargetCode, name: "Drumatis Trickstar Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setTrickstar], race: raceFairy, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
    { code: linkedTrickstarCode, name: "Drumatis Linked Trickstar Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, setcodes: [setTrickstar], race: raceFairy, attribute: attributeLight, level: 2, attack: 1400, defense: 0, linkMarkers: 0x20 },
    { code: unlinkedTrickstarCode, name: "Drumatis Unlinked Trickstar Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, setcodes: [setTrickstar], race: raceFairy, attribute: attributeLight, level: 2, attack: 1300, defense: 0, linkMarkers: 0x8 },
    { code: burnSpellCode, name: "Drumatis Effect Damage Probe", kind: "spell", typeFlags: typeSpell },
  ];
}

function burnSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DAMAGE)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,400)
      end)
      e:SetOperation(function(e,tp) Duel.Damage(1-tp,400,REASON_EFFECT) end)
      c:RegisterEffect(e)
    end
  `;
}

function expectDrumatisScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Trickstar Band Drumatis");
  expect(script).toContain("Fusion.AddProcMixN(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_TRICKSTAR),2)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("c:IsLinkMonster() and c:IsSetCard(SET_TRICKSTAR) and c:GetLinkedGroup():IsContains(e:GetHandler())");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCondition(function(e) return e:GetHandler():IsFusionSummoned() end)");
  expect(script).toContain("not Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,c:GetCode()),tp,LOCATION_ONFIELD|LOCATION_GRAVE,0,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,tp,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e3:SetCode(EVENT_DAMAGE)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.HasNonZeroAttack,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
}

function sentToHandEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
  };
}

function chainSolvedEvent(effectId: number, chainLinkId: string) {
  return {
    eventName: "chainSolved",
    eventCode: 1022,
    eventPlayer: 0,
    eventValue: 1,
    eventReasonPlayer: 0,
    relatedEffectId: effectId,
    eventChainDepth: 1,
    eventChainLinkId: chainLinkId,
  };
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function sameMembers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((uid) => actual.includes(uid));
}
