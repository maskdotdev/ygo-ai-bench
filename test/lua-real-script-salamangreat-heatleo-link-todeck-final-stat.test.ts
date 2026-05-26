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
const heatleoCode = "41463181";
const opponentBackrowCode = "414631810";
const graveSourceCode = "414631811";
const fieldTargetCode = "414631812";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHeatleoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${heatleoCode}.lua`));
const salamangreatSanctuaryCode = 1295111;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const typeSpell = 0x2;
const raceCyberse = 0x1000000;
const attributeFire = 0x4;
const summonTypeLink = 0x4c000000;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasHeatleoScript)("Lua real script Salamangreat Heatleo link to-Deck final stat", () => {
  it("restores Link Summon success opponent backrow shuffle", () => {
    const { workspace, reader, session } = createHeatleoSession(41463181);
    const heatleo = requireCard(session, heatleoCode);
    const opponentBackrow = requireCard(session, opponentBackrowCode);
    moveDuelCard(session.state, opponentBackrow.uid, "spellTrapZone", 1).faceUp = false;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(heatleoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === heatleo.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", id: "lua-1-31", property: 0x40400, range: ["extraDeck"] },
      { category: 0x10, code: 1102, event: "trigger", id: "lua-4-1102", property: 0x10010, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: 0x200000, code: undefined, event: "ignition", id: "lua-5", property: 0x10, range: ["monsterZone"] },
    ]);

    specialSummonDuelCard(session.state, heatleo.uid, 0, 0, {}, summonTypeLink, true, false);
    markProcedureComplete(heatleo);
    expect(session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1102", eventCardUid: heatleo.uid, eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: heatleo.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const shuffle = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === heatleo.uid);
    expect(shuffle, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, shuffle!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponentBackrow.uid)).toMatchObject({
      location: "deck",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: heatleo.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToDeck"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
    }))).toEqual([
      { current: "monsterZone", eventCardUid: heatleo.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "extraDeck" },
      { current: "deck", eventCardUid: opponentBackrow.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: heatleo.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "spellTrapZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores reincarnation-summoned ignition target pair into final ATK copy", () => {
    const { workspace, reader, session } = createHeatleoSession(41463182);
    const heatleo = requireCard(session, heatleoCode);
    const graveSource = requireCard(session, graveSourceCode);
    const fieldTarget = requireCard(session, fieldTargetCode);
    moveFaceUpAttack(session, heatleo, 0, 0);
    heatleo.summonType = "link";
    heatleo.summonTypeCode = summonTypeLink;
    markProcedureComplete(heatleo);
    registerDuelFlagEffect(session.state, { ownerType: "card", ownerId: heatleo.uid }, salamangreatSanctuaryCode, 0, 0, 1);
    moveDuelCard(session.state, graveSource.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, fieldTarget, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(heatleoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const copyAttack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === heatleo.uid && action.effectId === "lua-5");
    expect(copyAttack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, copyAttack!);
    resolveRestoredChain(restoredOpen);

    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === heatleo.uid), restoredOpen.session.state)).toBe(1800);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === fieldTarget.uid), restoredOpen.session.state)).toBe(900);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: 0x400, reset: { flags: 1107169792 }, sourceUid: heatleo.uid, value: 1800 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "graveyard", eventCardUid: graveSource.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", relatedEffectId: 5 },
      { current: "monsterZone", eventCardUid: heatleo.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "extraDeck", relatedEffectId: 5 },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createHeatleoSession(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${heatleoCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [graveSourceCode], extra: [heatleoCode] },
    1: { main: [opponentBackrowCode, fieldTargetCode] },
  });
  startDuel(session);
  return { workspace, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Salamangreat Heatleo");
  expect(script).toContain("aux.EnableCheckReincarnation(c)");
  expect(script).toContain("Link.AddProcedure(c,s.matfilter,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_TODECK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsLinkSummoned()");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToDeck,tp,0,LOCATION_STZONE,1,1,nil)");
  expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("return c:IsReincarnationSummoned() and c:IsLinkSummoned()");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter1,tp,LOCATION_GRAVE,0,1,1,nil,tp)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter2,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,g1:GetFirst():GetAttack())");
  expect(script).toContain("local g=Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(gc:GetAttack())");
}

function cards(): DuelCardData[] {
  return [
    { code: heatleoCode, name: "Salamangreat Heatleo", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeFire, level: 3, attack: 2300, defense: 0, linkMarkers: 0x44, linkMaterialMin: 2 },
    { code: opponentBackrowCode, name: "Heatleo Opponent Backrow", kind: "spell", typeFlags: typeSpell },
    { code: graveSourceCode, name: "Heatleo Grave ATK Source", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeFire, level: 4, attack: 1800, defense: 1000 },
    { code: fieldTargetCode, name: "Heatleo Field ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeFire, level: 4, attack: 900, defense: 1000 },
  ];
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
