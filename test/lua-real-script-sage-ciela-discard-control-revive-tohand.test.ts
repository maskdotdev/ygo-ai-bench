import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const cielaCode = "34456146";
const discardSpellCode = "344561460";
const graveSpellCode = "344561461";
const banishedSpellCode = "344561462";
const skyStrikerAceCode = "344561463";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCielaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cielaCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceMachine = 0x2000;
const raceSpellcaster = 0x10;
const attributeLight = 0x10;
const setSkyStriker = 0x115;
const setSkyStrikerAce = 0x1115;
const eventToGrave = 1014;
const reasonDiscardCost = duelReason.cost | duelReason.discard;

describe.skipIf(!hasUpstreamScripts || !hasCielaScript)("Lua real script Sage of Benevolence Ciela discard control revive to-hand", () => {
  it("restores hand ignition spell discard cost into self Special Summon", () => {
    const { workspace, reader, session } = createFixture(34456146);
    expectScriptShape(workspace.readScript(`official/c${cielaCode}.lua`) ?? "");
    const ciela = requireCard(session, cielaCode);
    const discardSpell = requireCard(session, discardSpellCode);
    moveDuelCard(session.state, ciela.uid, "hand", 0);
    moveDuelCard(session.state, discardSpell.uid, "hand", 0);
    prepareMainPhase(session);
    registerCiela(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === ciela.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: 0x200, code: undefined, event: "ignition", id: "lua-1", property: undefined, range: ["hand"], triggerEvent: undefined },
      { category: 0x2200, code: undefined, event: "ignition", id: "lua-2", property: undefined, range: ["monsterZone"], triggerEvent: undefined },
      { category: 0x8, code: eventToGrave, event: "trigger", id: `lua-3-${eventToGrave}`, property: 0x10010, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "sentToGraveyard" },
    ]);

    const special = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === ciela.uid && action.effectId === "lua-1");
    expect(special, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, special!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === discardSpell.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: reasonDiscardCost,
      reasonPlayer: 0,
      reasonCardUid: ciela.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ciela.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: ciela.uid,
      reasonEffectId: 1,
    });
  });

  it("restores field ignition grave Spell banish cost into self-control transfer and Sky Striker Ace revive", () => {
    const { workspace, reader, session } = createFixture(34456147);
    const ciela = requireCard(session, cielaCode);
    const graveSpell = requireCard(session, graveSpellCode);
    const skyStrikerAce = requireCard(session, skyStrikerAceCode);
    moveFaceUpAttack(session, ciela, 0);
    moveDuelCard(session.state, graveSpell.uid, "graveyard", 0);
    graveSpell.faceUp = true;
    moveDuelCard(session.state, skyStrikerAce.uid, "graveyard", 0);
    skyStrikerAce.faceUp = true;
    prepareMainPhase(session);
    registerCiela(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const transfer = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === ciela.uid && action.effectId === "lua-2");
    expect(transfer, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, transfer!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === graveSpell.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: ciela.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ciela.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ciela.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === skyStrikerAce.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: ciela.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["banished", "controlChanged", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "banished", eventCardUid: graveSpell.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: ciela.uid, eventReasonEffectId: 2, previous: "graveyard", current: "banished", previousController: 0, currentController: 0 },
      { eventName: "controlChanged", eventCardUid: ciela.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ciela.uid, eventReasonEffectId: 2, previous: "monsterZone", current: "monsterZone", previousController: 0, currentController: 1 },
      { eventName: "specialSummoned", eventCardUid: skyStrikerAce.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: ciela.uid, eventReasonEffectId: 2, previous: "graveyard", current: "monsterZone", previousController: 0, currentController: 0 },
    ]);
  });

  it("restores destroyed-to-grave trigger that returns a banished Sky Striker Spell to hand", () => {
    const { workspace, reader, session } = createFixture(34456148);
    const ciela = requireCard(session, cielaCode);
    const banishedSpell = requireCard(session, banishedSpellCode);
    moveFaceUpAttack(session, ciela, 0);
    moveDuelCard(session.state, banishedSpell.uid, "banished", 0);
    banishedSpell.faceUp = true;
    prepareMainPhase(session);
    registerCiela(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    destroyDuelCard(restoredOpen.session.state, ciela.uid, 1, duelReason.effect | duelReason.destroy, 1);
    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    expect(restoredDestroyed.session.state.pendingTriggers.map((trigger) => ({
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
      {
        effectId: `lua-3-${eventToGrave}`,
        eventCardUid: ciela.uid,
        eventCode: eventToGrave,
        eventName: "sentToGraveyard",
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        player: 0,
        sourceUid: ciela.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const retrieve = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) => action.type === "activateTrigger" && action.uid === ciela.uid && action.effectId === `lua-3-${eventToGrave}`);
    expect(retrieve, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, retrieve!);
    resolveRestoredChain(restoredDestroyed);

    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === banishedSpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ciela.uid,
      reasonEffectId: 3,
    });
    expect(restoredDestroyed.session.state.eventHistory.filter((event) => ["becameTarget", "sentToHand"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCardUid: banishedSpell.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, previous: "deck", current: "banished" },
      { eventName: "sentToHand", eventCardUid: banishedSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ciela.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "banished", current: "hand" },
    ]);
  });
});

function createFixture(seed: number): {
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  reader: ReturnType<typeof createCardReader>;
  session: DuelSession;
} {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [cielaCode, discardSpellCode, graveSpellCode, banishedSpellCode, skyStrikerAceCode] },
    1: { main: [] },
  });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: cielaCode, name: "Sage of Benevolence - Ciela", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 6, attack: 2200, defense: 1000 },
    { code: discardSpellCode, name: "Ciela Discard Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setSkyStriker] },
    { code: graveSpellCode, name: "Ciela Grave Sky Striker Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setSkyStriker] },
    { code: banishedSpellCode, name: "Ciela Banished Sky Striker Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setSkyStriker] },
    { code: skyStrikerAceCode, name: "Ciela Sky Striker Ace Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 4, attack: 1500, defense: 1500, setcodes: [setSkyStrikerAce] },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("Sage of Benevolence - Ciela");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("Duel.DiscardHand(tp,s.spcfilter,1,1,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_CONTROL+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.GetControl(c,1-tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return c:IsReason(REASON_DESTROY) and c:IsReason(REASON_BATTLE|REASON_EFFECT)");
  expect(script).toContain("return c:IsSetCard(SET_SKY_STRIKER) and c:IsSpell() and c:IsFaceup() and c:IsAbleToHand()");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerCiela(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(cielaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
