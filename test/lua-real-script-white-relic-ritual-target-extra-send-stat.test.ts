import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, ritualSummonDuelCard, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const relicCode = "48654323";
const materialCode = "486543230";
const allyCode = "486543231";
const opponentExtraCode = "486543232";
const opponentExtraSendCode = "486543233";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRelicScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${relicCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeRitual = 0x80;
const attributeLight = 0x10;
const raceSpellcaster = 0x2;
const setDogmatika = 0x146;
const effectUpdateAttack = 100;
const effectIndestructableBattle = 42;
const eventSpecialSummonSuccess = 1102;

describe.skipIf(!hasUpstreamScripts || !hasRelicScript)("Lua real script White Relic ritual target extra send stat", () => {
  it("restores Ritual summon SelectUnselectGroup targets into ATK gain and Dogmatika battle protection", () => {
    const { workspace, reader, session } = createRelicSession(48654323);
    const relic = requireCard(session, relicCode);
    const material = requireCard(session, materialCode);
    const ally = requireCard(session, allyCode);
    moveDuelCard(session.state, relic.uid, "hand", 0);
    moveDuelCard(session.state, material.uid, "hand", 0);
    moveFaceUpAttack(session, ally, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(relicCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    ritualSummonDuelCard(restoredOpen.session.state, 0, relic.uid, [material.uid], "faceUpAttack");
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-2-1102",
        eventCardUid: relic.uid,
        eventCode: eventSpecialSummonSuccess,
        eventName: "specialSummoned",
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.ritual,
        player: 0,
        sourceUid: relic.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const boost = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateTrigger" && action.effectId === "lua-2-1102");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, boost!);
    resolveRestoredChain(restoredOpen);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === ally.uid), restoredOpen.session.state)).toBe(4000);
    expect(restoredOpen.session.state.effects.find((effect) => effect.sourceUid === ally.uid && effect.code === effectUpdateAttack)).toMatchObject({
      code: effectUpdateAttack,
      property: 0x400,
      value: 2000,
    });
    expect(restoredOpen.session.state.effects.find((effect) => effect.sourceUid === relic.uid && effect.code === effectIndestructableBattle)).toMatchObject({
      code: effectIndestructableBattle,
      targetRange: [0x4, 0],
      value: 1,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: relic.uid, eventCode: eventSpecialSummonSuccess, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon | duelReason.ritual, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: ally.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 2 },
      { eventCardUid: relic.uid, eventCode: 1028, eventName: "becameTarget", eventReason: duelReason.summon | duelReason.specialSummon | duelReason.ritual, eventReasonPlayer: 0, relatedEffectId: 2 },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores opponent Extra Deck summon trigger into confirmed Extra Deck send and shuffle", () => {
    const { workspace, reader, session } = createRelicSession(48654324);
    const relic = requireCard(session, relicCode);
    const opponentExtra = requireCard(session, opponentExtraCode, 1);
    const opponentSend = requireCard(session, opponentExtraSendCode, 1);
    moveFaceUpAttack(session, relic, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(relicCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    specialSummonDuelCard(session.state, opponentExtra.uid, 1, 1, {}, 0x43000000, true, true);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const send = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.effectId === "lua-4-1102");
    expect(send, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, send!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponentSend.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: relic.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventCardUid === opponentSend.uid && ["confirmed", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: opponentSend.uid, eventCode: 1211, eventName: "confirmed", eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: undefined },
      { eventCardUid: opponentSend.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: relic.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRelicSession(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${relicCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [relicCode, materialCode, allyCode] },
    1: { main: [], extra: [opponentExtraCode, opponentExtraSendCode] },
  });
  startDuel(session);
  return { workspace, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("White Relic of Dogmatika");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("return e:GetHandler():IsRitualSummoned()");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,s.atkrescon,1,tp,HINTMSG_ATKDEF)");
  expect(script).toContain("Duel.SetTargetCard(tg)");
  expect(script).toContain("Duel.GetTargetCards(e):Filter(Card.IsFaceup,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsSummonLocation(LOCATION_EXTRA) and c:IsPreviousControler(1-tp)");
  expect(script).toContain("Duel.GetFieldGroup(tp,0,LOCATION_EXTRA)");
  expect(script).toContain("Duel.ConfirmCards(tp,g)");
  expect(script).toContain("Duel.SendtoGrave(sg,REASON_EFFECT)");
  expect(script).toContain("Duel.ShuffleExtra(1-tp)");
}

function cards(): DuelCardData[] {
  return [
    { code: relicCode, name: "White Relic of Dogmatika", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 2000, defense: 2500, ritualMaterials: [materialCode], setcodes: [setDogmatika] },
    { code: materialCode, name: "White Relic Ritual Material", kind: "monster", typeFlags: typeMonster, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: allyCode, name: "White Relic Dogmatika Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 8, attack: 2000, defense: 2000, setcodes: [setDogmatika] },
    { code: opponentExtraCode, name: "White Relic Opponent Summoned Extra", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceSpellcaster, attribute: attributeLight, level: 6, attack: 2100, defense: 1600 },
    { code: opponentExtraSendCode, name: "White Relic Opponent Extra Send", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceSpellcaster, attribute: attributeLight, level: 6, attack: 2200, defense: 1600 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", card.controller);
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  moved.faceUp = true;
}

function requireCard(session: DuelSession, code: string, controller?: number): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
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
