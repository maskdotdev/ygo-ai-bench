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
const tagpartnerCode = "67586735";
const partnerCode = "675867350";
const linkCode = "675867351";
const goukiSpellCode = "675867352";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTagpartnerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tagpartnerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const typeSpell = 0x2;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const setGouki = 0xfc;
const eventBeMaterial = 1108;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasTagpartnerScript)("Lua real script Gouki Tagpartner Link material stat to-Deck", () => {
  it("restores Link material trigger into Gouki Link ATK gain", () => {
    const { workspace, reader, session } = createTagpartnerSession(67586735);
    const tagpartner = requireCard(session, tagpartnerCode);
    const partner = requireCard(session, partnerCode);
    const link = requireCard(session, linkCode);
    moveFaceUpAttack(session, tagpartner, 0, 0);
    moveFaceUpAttack(session, partner, 0, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tagpartnerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === tagpartner.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: 0x200000, code: eventBeMaterial, event: "trigger", id: "lua-1-1108", property: 0x10000, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: 0x10, code: undefined, event: "ignition", id: "lua-2", property: undefined, range: ["graveyard"] },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const linkSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "linkSummon" && action.uid === link.uid && sameMembers(action.materialUids, [tagpartner.uid, partner.uid])
    );
    expect(linkSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, linkSummon!);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-1-1108",
        eventCardUid: tagpartner.uid,
        eventCode: eventBeMaterial,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventName: "usedAsMaterial",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.link,
        eventReasonCardUid: link.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: tagpartner.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const boost = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === tagpartner.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, boost!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === link.uid), restoredTrigger.session.state)).toBe(2800);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === link.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: link.uid, value: 1000 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["usedAsMaterial", "becameTarget"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "graveyard", eventCardUid: tagpartner.uid, eventCode: eventBeMaterial, eventName: "usedAsMaterial", eventReason: duelReason.link, eventReasonCardUid: link.uid, eventReasonPlayer: 0, previous: "monsterZone", relatedEffectId: undefined },
      { current: "graveyard", eventCardUid: partner.uid, eventCode: eventBeMaterial, eventName: "usedAsMaterial", eventReason: duelReason.link, eventReasonCardUid: link.uid, eventReasonPlayer: 0, previous: "monsterZone", relatedEffectId: undefined },
      { current: "monsterZone", eventCardUid: link.uid, eventCode: 1028, eventName: "becameTarget", eventReason: duelReason.summon | duelReason.specialSummon | duelReason.link, eventReasonCardUid: undefined, eventReasonPlayer: 0, previous: "extraDeck", relatedEffectId: 1 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores grave self-banish cost into Gouki Spell shuffle to Deck", () => {
    const { workspace, reader, session } = createTagpartnerSession(67586736);
    const tagpartner = requireCard(session, tagpartnerCode);
    const goukiSpell = requireCard(session, goukiSpellCode);
    moveDuelCard(session.state, tagpartner.uid, "graveyard", 0).faceUp = true;
    tagpartner.turnId = 1;
    moveDuelCard(session.state, goukiSpell.uid, "graveyard", 0).faceUp = true;
    session.state.turn = 3;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tagpartnerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const shuffle = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === tagpartner.uid && action.effectId === "lua-2");
    expect(shuffle, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, shuffle!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === tagpartner.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: tagpartner.uid,
      reasonEffectId: 2,
    });
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === goukiSpell.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: tagpartner.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["banished", "sentToDeck"].includes(event.eventName)).map((event) => ({
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
      { current: "banished", eventCardUid: tagpartner.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: tagpartner.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard" },
      { current: "deck", eventCardUid: goukiSpell.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: tagpartner.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard" },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createTagpartnerSession(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${tagpartnerCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [tagpartnerCode, partnerCode, goukiSpellCode], extra: [linkCode] },
    1: { main: [] },
  });
  startDuel(session);
  return { workspace, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Gouki Tagpartner");
  expect(script).toContain("e1:SetCode(EVENT_BE_MATERIAL)");
  expect(script).toContain("Duel.SetTargetCard(e:GetHandler():GetReasonCard())");
  expect(script).toContain("r & REASON_LINK == REASON_LINK");
  expect(script).toContain("rc:IsSetCard(SET_GOUKI) and rc:IsType(TYPE_LINK)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCondition(aux.exccon)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: tagpartnerCode, name: "Gouki Tagpartner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 5, attack: 1700, defense: 0, setcodes: [setGouki] },
    { code: partnerCode, name: "Gouki Tagpartner Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000, setcodes: [setGouki] },
    { code: linkCode, name: "Gouki Tagpartner Link Result", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceWarrior, attribute: attributeEarth, level: 2, attack: 1800, defense: 0, linkMarkers: 0x3, linkMaterialMin: 2, linkMaterialMax: 2, setcodes: [setGouki] },
    { code: goukiSpellCode, name: "Gouki Tagpartner Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setGouki] },
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

function sameMembers(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return actual?.length === expected.length && expected.every((uid) => actual.includes(uid));
}
