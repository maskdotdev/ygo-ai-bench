import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dodododoCode = "62880279";
const costCode = "628802790";
const zubabaCode = "628802791";
const luckyCode = "82308875";
const opponentFieldCode = "628802792";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDodododoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dodododoCode}.lua`));
const hasLuckyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${luckyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const setDododo = 0x82;
const setZubaba = 0x8f;
const effectSetAttack = 101;
const effectChangeLevel = 131;
const effectCannotSpecialSummon = 22;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDodododoScript || !hasLuckyScript)("Lua real script Dodododo Warrior step lock search", () => {
  it("restores deck cost into hand SpecialSummonStep, Level/ATK changes, and Xyz-only Extra Deck lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dodododoCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 62880279, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dodododoCode, costCode], extra: [] }, 1: { main: [] } });
    startDuel(session);

    const dodododo = requireCard(session, dodododoCode);
    const cost = requireCard(session, costCode);
    moveDuelCard(session.state, dodododo.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dodododoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === dodododo.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: dodododo.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === dodododo.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: dodododo.uid,
      reasonEffectId: 1,
    });
    expect(currentLevel(restoredOpen.session.state.cards.find((card) => card.uid === dodododo.uid), restoredOpen.session.state)).toBe(4);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === dodododo.uid), restoredOpen.session.state)).toBe(1800);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === dodododo.uid && [effectChangeLevel, effectSetAttack, effectCannotSpecialSummon].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      description: effect.description,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLevel, description: undefined, event: "continuous", property: undefined, reset: { flags: 33492992 }, targetRange: undefined, value: 4 },
      { code: effectSetAttack, description: undefined, event: "continuous", property: undefined, reset: { flags: 33492992 }, targetRange: undefined, value: 1800 },
      { code: effectCannotSpecialSummon, description: 1006084466, event: "continuous", property: 0x4000800, reset: { flags: 0x40000200 }, targetRange: [1, 0], value: undefined },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: cost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: dodododo.uid, eventReasonEffectId: 1, previousLocation: "deck", currentLocation: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: dodododo.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: dodododo.uid, eventReasonEffectId: 1, previousLocation: "hand", currentLocation: "monsterZone" },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores overlay-cost Xyz activation trigger into Zubaba Deck search and confirmation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 62880280, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dodododoCode, zubabaCode], extra: [luckyCode] }, 1: { main: [opponentFieldCode] } });
    startDuel(session);

    const dodododo = requireCard(session, dodododoCode);
    const zubaba = requireCard(session, zubabaCode);
    const lucky = requireCard(session, luckyCode);
    const opponentField = requireCard(session, opponentFieldCode);
    moveFaceUpAttack(session, lucky, 0);
    moveDuelCard(session.state, dodododo.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    lucky.overlayUids.push(dodododo.uid);
    moveFaceUpAttack(session, opponentField, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const promptOverrides = [{ api: "SelectEffect" as const, player: 0 as const, returned: 1 }];
    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    expect(host.loadCardScript(Number(dodododoCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(luckyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const luckyEffect = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === lucky.uid);
    expect(luckyEffect, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, luckyEffect!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === dodododo.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: lucky.uid,
      reasonEffectId: 5,
    });
    expect(restoredOpen.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === dodododo.uid)).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1014",
        sourceUid: dodododo.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventPlayer: 0,
        eventCardUid: dodododo.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: lucky.uid,
        eventReasonEffectId: 5,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const search = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === dodododo.uid);
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, search!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === zubaba.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: dodododo.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "detachedMaterial", "sentToHand", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: dodododo.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: lucky.uid, eventReasonEffectId: 5, previousLocation: "overlay", currentLocation: "graveyard" },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: dodododo.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: lucky.uid, eventReasonEffectId: 5, previousLocation: "overlay", currentLocation: "graveyard" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: zubaba.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: dodododo.uid, eventReasonEffectId: 2, previousLocation: "deck", currentLocation: "hand" },
      { eventName: "sentToHandConfirmed", eventCode: 1212, eventCardUid: zubaba.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: dodododo.uid, eventReasonEffectId: 2, previousLocation: "deck", currentLocation: "hand" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_LVCHANGE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spcostfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("Duel.SpecialSummonStep(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_ATTACK)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("return not c:IsType(TYPE_XYZ) and c:IsLocation(LOCATION_EXTRA)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("e3:SetCode(EVENT_REMOVE)");
  expect(script).toContain("c:IsReason(REASON_COST) and re:IsActivated() and re:IsActiveType(TYPE_XYZ) and c:IsPreviousLocation(LOCATION_OVERLAY)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === luckyCode),
    { code: dodododoCode, name: "Dodododo Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDododo], level: 6, attack: 2300, defense: 900 },
    { code: costCode, name: "Dododo Deck Cost", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDododo], level: 4, attack: 1000, defense: 1000 },
    { code: zubabaCode, name: "Zubaba Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setZubaba], level: 4, attack: 1600, defense: 1000 },
    { code: opponentFieldCode, name: "Dodododo Opponent Field", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
