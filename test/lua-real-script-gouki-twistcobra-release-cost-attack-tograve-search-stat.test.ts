import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const twistcobraCode = "97688360";
const releaseCostCode = "976883600";
const boostTargetCode = "976883601";
const searchTargetCode = "976883602";
const offSetDecoyCode = "976883603";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasTwistcobraScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${twistcobraCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setGouki = 0xfc;
const raceWarrior = 0x1;
const raceBeast = 0x4000;
const attributeEarth = 0x1;
const attributeFire = 0x4;
const effectUpdateAttack = 100;
const effectFlagCardTarget = 0x10;
const effectFlagDamageStep = 0x4000;
const categoryAtkChange = 0x200000;
const resetsStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasTwistcobraScript)("Lua real script Gouki Twistcobra release-cost attack to-grave search stat", () => {
  it("restores release-cost Gouki ATK gain and field-to-Grave Gouki search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectTwistcobraScriptShape(workspace.readScript(`official/c${twistcobraCode}.lua`));
    const twistcobraData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === twistcobraCode);
    expect(twistcobraData).toBeDefined();
    const reader = createCardReader([
      { ...twistcobraData!, setcodes: [setGouki] },
      ...fixtureCards(),
    ]);

    const restoredBoost = createRestoredBoostWindow({ reader, workspace });
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    const twistcobra = requireCard(restoredBoost.session, twistcobraCode);
    const releaseCost = requireCard(restoredBoost.session, releaseCostCode);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.sourceUid === twistcobra.uid && effect.category === categoryAtkChange && effect.property === effectFlagCardTarget + effectFlagDamageStep).map((effect) => ({
      category: effect.category,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: categoryAtkChange, event: "quick", property: effectFlagCardTarget + effectFlagDamageStep, range: ["monsterZone"], sourceUid: twistcobra.uid },
    ]);

    const boost = getLuaRestoreLegalActions(restoredBoost, 0).find((action) =>
      action.type === "activateEffect" && action.uid === twistcobra.uid && action.effectId?.startsWith("lua-1")
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, boost!);
    resolveRestoredChain(restoredBoost);

    expect(restoredBoost.session.state.cards.find((card) => card.uid === releaseCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: twistcobra.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === twistcobra.uid), restoredBoost.session.state)).toBe(2500);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.sourceUid === twistcobra.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: resetsStandardPhaseEnd }, sourceUid: twistcobra.uid, value: 900 },
    ]);
    expect(restoredBoost.session.state.eventHistory.filter((event) => ["released", "becameTarget", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: releaseCost.uid,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: twistcobra.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: twistcobra.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      chainSolvedEvent(1, "chain-3"),
    ]);

    const restoredGraveOpen = createRestoredSearchWindow({ reader, workspace });
    expectCleanRestore(restoredGraveOpen);
    expectRestoredLegalActions(restoredGraveOpen, 0);
    const graveTwistcobra = requireCard(restoredGraveOpen.session, twistcobraCode);
    const searchTarget = requireCard(restoredGraveOpen.session, searchTargetCode);
    const offSetDecoy = requireCard(restoredGraveOpen.session, offSetDecoyCode);
    sendDuelCardToGraveyard(restoredGraveOpen.session.state, graveTwistcobra.uid, 0, duelReason.effect, 0);
    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(restoredGraveOpen.session), workspace, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    expect(restoredSearch.session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-2-1014", eventCardUid: graveTwistcobra.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonPlayer: 0, player: 0, sourceUid: graveTwistcobra.uid, triggerBucket: "turnOptional" },
    ]);
    const search = getLuaRestoreLegalActions(restoredSearch, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === graveTwistcobra.uid && action.effectId === "lua-2-1014"
    );
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, search!);
    resolveRestoredChain(restoredSearch);

    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveTwistcobra.uid,
      reasonEffectId: 2,
    });
    expect(restoredSearch.session.state.cards.find((card) => card.uid === offSetDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["sentToGraveyard", "sentToHand", "confirmed", "sentToHandConfirmed", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: graveTwistcobra.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      sentToHandEvent(searchTarget.uid, graveTwistcobra.uid, 2, 2),
      confirmedEvent(searchTarget.uid, graveTwistcobra.uid, 2, 2),
      sentToHandConfirmedEvent(searchTarget.uid, graveTwistcobra.uid, 2, 2),
      chainSolvedEvent(2, "chain-3"),
    ]);
    expect(restoredSearch.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredBoostWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 97688360, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [releaseCostCode, twistcobraCode, boostTargetCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, releaseCostCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, twistcobraCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, boostTargetCode), 0, 2);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerTwistcobra(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredSearchWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 97688361, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [twistcobraCode, searchTargetCode, offSetDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, twistcobraCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerTwistcobra(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function fixtureCards(): DuelCardData[] {
  return [
    { code: releaseCostCode, name: "Gouki Twistcobra Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGouki], race: raceWarrior, attribute: attributeEarth, level: 3, attack: 900, defense: 1000 },
    { code: boostTargetCode, name: "Gouki Twistcobra Boost Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGouki], race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: searchTargetCode, name: "Gouki Twistcobra Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGouki], race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
    { code: offSetDecoyCode, name: "Gouki Twistcobra Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeFire, level: 4, attack: 1600, defense: 1000 },
  ];
}

function registerTwistcobra(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(twistcobraCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectTwistcobraScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Gouki Twistcobra");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.atkfilter1,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.atkfilter1,1,1,false,nil,nil,tp)");
  expect(script).toContain("e:SetLabel(g:GetFirst():GetBaseAttack())");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter2,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel())");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
  expect(script).toContain("return c:IsSetCard(SET_GOUKI) and not c:IsCode(id) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
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
