import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dragonCode = "81522098";
const nonMimighoulCode = "815220980";
const mimighoulAllyCode = "815220981";
const searchSpellCode = "815220982";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDragonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dragonCode}.lua`));
const setMimighoul = 0x1b5;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const categoryDestroy = 0x1;
const categoryToHand = 0x8;
const categorySpecialSummon = 0x200;
const categoryControl = 0x2000;
const categorySearch = 0x20000;
const categorySet = 0x100000000;
const effectFlagDelay = 0x10000;
const allLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasDragonScript)("Lua real script Mimighoul Dragon flip summon search", () => {
  it("restores face-down opponent summon, Main Phase FLIP destroy-control, and summon search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${dragonCode}.lua`));
    const reader = createCardReader(cards());

    const selfSummon = createRestoredHandField({ reader, workspace });
    expect(selfSummon.restored.session.state.effects.filter((effect) => effect.sourceUid === selfSummon.dragon.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryDestroy | categoryControl, code: undefined, countLimit: 1, event: "trigger", property: undefined, range: allLocations, sourceUid: selfSummon.dragon.uid, triggerEvent: "flipSummoned" },
      { category: categorySpecialSummon + categorySet, code: undefined, countLimit: 1, event: "ignition", property: undefined, range: ["hand"], sourceUid: selfSummon.dragon.uid, triggerEvent: undefined },
      { category: categorySearch | categoryToHand, code: 1100, countLimit: 1, event: "trigger", property: effectFlagDelay, range: allLocations, sourceUid: selfSummon.dragon.uid, triggerEvent: "normalSummoned" },
      { category: categorySearch | categoryToHand, code: 1102, countLimit: 1, event: "trigger", property: effectFlagDelay, range: allLocations, sourceUid: selfSummon.dragon.uid, triggerEvent: "specialSummoned" },
    ]);
    const handIgnition = getLuaRestoreLegalActions(selfSummon.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === selfSummon.dragon.uid && action.effectId === "lua-2"
    );
    expect(handIgnition, JSON.stringify(getLuaRestoreLegalActions(selfSummon.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(selfSummon.restored, handIgnition!);
    passRestoredChain(selfSummon.restored);

    expect(findCard(selfSummon.restored.session, selfSummon.dragon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      faceUp: false,
      position: "faceDownDefense",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: selfSummon.dragon.uid,
      reasonEffectId: 2,
    });
    expect(selfSummon.restored.host.messages).toContain(`confirmed 0: ${dragonCode}`);
    expect(selfSummon.restored.session.state.eventHistory.filter((event) => ["specialSummoned", "confirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      previousController: event.eventPreviousState?.controller,
      currentLocation: event.eventCurrentState?.location,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: selfSummon.dragon.uid, eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: selfSummon.dragon.uid, eventReasonEffectId: 2, previousLocation: "hand", previousController: 0, currentLocation: "monsterZone", currentController: 1 },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: selfSummon.dragon.uid, eventPlayer: 0, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: selfSummon.dragon.uid, eventReasonEffectId: 2, previousLocation: "hand", previousController: 0, currentLocation: "monsterZone", currentController: 1 },
    ]);

    const flip = createRestoredFlipField({ reader, workspace });
    const flipSummon = getLuaRestoreLegalActions(flip.restored, 0).find((action) =>
      action.type === "flipSummon" && action.uid === flip.dragon.uid
    );
    expect(flipSummon, JSON.stringify(getLuaRestoreLegalActions(flip.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(flip.restored, flipSummon!);
    const restoredFlipTrigger = restoreDuelWithLuaScripts(serializeDuel(flip.restored.session), workspace, reader);
    expectCleanRestore(restoredFlipTrigger);
    expectRestoredLegalActions(restoredFlipTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredFlipTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === flip.dragon.uid && action.effectId === "lua-1"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredFlipTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFlipTrigger, trigger!);
    passRestoredChain(restoredFlipTrigger);

    expect(findCard(restoredFlipTrigger.session, flip.nonMimighoul.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: flip.dragon.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restoredFlipTrigger.session, flip.mimighoulAlly.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(findCard(restoredFlipTrigger.session, flip.dragon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: flip.dragon.uid,
      reasonEffectId: 1,
    });
    expect(restoredFlipTrigger.session.state.eventHistory.filter((event) => ["flipSummoned", "destroyed", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      previousController: event.eventPreviousState?.controller,
      currentLocation: event.eventCurrentState?.location,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "flipSummoned", eventCode: 1101, eventCardUid: flip.dragon.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "deck", previousController: 0, currentLocation: "monsterZone", currentController: 0 },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: flip.nonMimighoul.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: flip.dragon.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", previousController: 0, currentLocation: "graveyard", currentController: 0 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: flip.dragon.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: flip.dragon.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", previousController: 0, currentLocation: "monsterZone", currentController: 1 },
    ]);

    const search = createRestoredSearchField({ reader, workspace });
    const normalSummon = getLuaRestoreLegalActions(search.restored, 0).find((action) =>
      action.type === "normalSummon" && action.uid === search.dragon.uid
    );
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(search.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(search.restored, normalSummon!);
    const restoredSearchTrigger = restoreDuelWithLuaScripts(serializeDuel(search.restored.session), workspace, reader);
    expectCleanRestore(restoredSearchTrigger);
    expectRestoredLegalActions(restoredSearchTrigger, 0);
    const searchTrigger = getLuaRestoreLegalActions(restoredSearchTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === search.dragon.uid && action.effectId === "lua-3-1100"
    );
    expect(searchTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSearchTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearchTrigger, searchTrigger!);
    passRestoredChain(restoredSearchTrigger);

    expect(findCard(restoredSearchTrigger.session, search.searchSpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: search.dragon.uid,
      reasonEffectId: 3,
    });
    expect(restoredSearchTrigger.host.messages).toContain(`confirmed 1: ${searchSpellCode}`);
    expect(restoredSearchTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: search.dragon.uid, eventPlayer: undefined, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: search.searchSpell.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: search.dragon.uid, eventReasonEffectId: 3 },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: search.searchSpell.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: search.dragon.uid, eventReasonEffectId: 3 },
      { eventName: "sentToHandConfirmed", eventCode: 1212, eventCardUid: search.searchSpell.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: search.dragon.uid, eventReasonEffectId: 3 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Mimighoul Dragon");
  expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCondition(function() return Duel.IsMainPhase() end)");
  expect(script).toContain("Duel.GetMatchingGroup(s.desfilter,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");
  expect(script).toContain("Duel.GetControl(c,1-tp)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_SET)");
  expect(script).toContain("e2:SetRange(LOCATION_HAND)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,1-tp,false,false,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.ConfirmCards(tp,c)");
  expect(script).toContain("e3:SetCategory(CATEGORY_SEARCH+CATEGORY_TOHAND)");
  expect(script).toContain("e3:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e4:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function createRestoredHandField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}) {
  const session = createBaseSession(reader, { main: [dragonCode] }, { main: [] });
  const dragon = requireCard(session, dragonCode);
  moveDuelCard(session.state, dragon.uid, "hand", 0);
  const restored = registerAndRestore(session, workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { restored, dragon };
}

function createRestoredFlipField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}) {
  const session = createBaseSession(reader, { main: [dragonCode, nonMimighoulCode, mimighoulAllyCode] }, { main: [] });
  const dragon = requireCard(session, dragonCode);
  const nonMimighoul = requireCard(session, nonMimighoulCode);
  const mimighoulAlly = requireCard(session, mimighoulAllyCode);
  moveDuelCard(session.state, dragon.uid, "monsterZone", 0);
  dragon.faceUp = false;
  dragon.position = "faceDownDefense";
  moveFaceUpAttack(session, nonMimighoul, 0, 1);
  moveFaceUpAttack(session, mimighoulAlly, 0, 2);
  const restored = registerAndRestore(session, workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { restored, dragon, nonMimighoul, mimighoulAlly };
}

function createRestoredSearchField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}) {
  const session = createBaseSession(reader, { main: [dragonCode, searchSpellCode] }, { main: [] });
  const dragon = requireCard(session, dragonCode);
  const searchSpell = requireCard(session, searchSpellCode);
  moveDuelCard(session.state, dragon.uid, "hand", 0);
  const restored = registerAndRestore(session, workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { restored, dragon, searchSpell };
}

function createBaseSession(reader: ReturnType<typeof createCardReader>, player0: { main: string[] }, player1: { main: string[] }): DuelSession {
  const session = createDuel({ seed: 81522098, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: player0, 1: player1 });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerAndRestore(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, reader: ReturnType<typeof createCardReader>) {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dragonCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(): DuelCardData[] {
  return [
    mimighoulMonster(dragonCode, "Mimighoul Dragon", raceDragon, 1500, 1500),
    { code: nonMimighoulCode, name: "Mimighoul Dragon Non-Mimighoul Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
    mimighoulMonster(mimighoulAllyCode, "Mimighoul Dragon Mimighoul Ally", raceWarrior, 1200, 1000),
    { code: searchSpellCode, name: "Mimighoul Dragon Search Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setMimighoul] },
  ];
}

function mimighoulMonster(code: string, name: string, race: number, attack: number, defense: number): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect,
    setcodes: [setMimighoul],
    race,
    attribute: attributeEarth,
    level: 4,
    attack,
    defense,
  };
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
