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
const maceCode = "81945676";
const tecuhtlicaCode = "23288411";
const mementoDestroyCode = "819456760";
const searchCode = "819456761";
const controlTargetCode = "819456762";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMaceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${maceCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setMemento = 0x19a;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x10;
const attributeEarth = 0x1;
const categoryDestroy = 0x1;
const categoryToHand = 0x8;
const categoryControl = 0x2000;
const categorySearch = 0x20000;
const effectFlagCardTarget = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasMaceScript)("Lua real script Mementotlan Mace control search", () => {
  it("restores opponent-turn SelfDiscard control and Memento destroy-to-search ignition", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${maceCode}.lua`));
    const reader = createCardReader(cards());

    const control = createRestoredControlField({ reader, workspace });
    expect(control.restored.session.state.effects.filter((effect) => effect.sourceUid === control.mace.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: categoryControl, code: 1002, countLimit: 1, event: "quick", property: effectFlagCardTarget, range: ["hand"], sourceUid: control.mace.uid },
      { category: categoryDestroy | categoryToHand | categorySearch, code: undefined, countLimit: 1, event: "ignition", property: undefined, range: ["monsterZone"], sourceUid: control.mace.uid },
    ]);
    const quick = getLuaRestoreLegalActions(control.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === control.mace.uid && action.effectId === "lua-1-1002"
    );
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(control.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(control.restored, quick!);
    passRestoredChain(control.restored);

    expect(findCard(control.restored.session, control.mace.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: control.mace.uid,
      reasonEffectId: 1,
    });
    expect(findCard(control.restored.session, control.controlTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: control.mace.uid,
      reasonEffectId: 1,
    });
    expect(control.restored.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      previousController: event.eventPreviousState?.controller,
      currentLocation: event.eventCurrentState?.location,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: control.mace.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: control.mace.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previousLocation: "hand", previousController: 0, currentLocation: "graveyard", currentController: 0 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: control.controlTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previousLocation: "deck", previousController: 1, currentLocation: "monsterZone", currentController: 1 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: control.controlTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: control.mace.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previousLocation: "monsterZone", previousController: 1, currentLocation: "monsterZone", currentController: 0 },
    ]);

    const search = createRestoredSearchField({ reader, workspace });
    const ignition = getLuaRestoreLegalActions(search.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === search.mace.uid && action.effectId === "lua-2"
    );
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(search.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(search.restored, ignition!);
    passRestoredChain(search.restored);

    expect(findCard(search.restored.session, search.mace.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: search.mace.uid,
      reasonEffectId: 2,
    });
    expect(findCard(search.restored.session, search.searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: search.mace.uid,
      reasonEffectId: 2,
    });
    expect(findCard(search.restored.session, search.destroyTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(search.restored.host.messages).toContain(`confirmed 1: ${searchCode}`);
    expect(search.restored.session.state.eventHistory.filter((event) => ["destroyed", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: search.mace.uid, eventPlayer: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: search.mace.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: search.searchTarget.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: search.mace.uid, eventReasonEffectId: 2, previousLocation: "deck", currentLocation: "hand" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: search.searchTarget.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: search.mace.uid, eventReasonEffectId: 2, previousLocation: "deck", currentLocation: "hand" },
      { eventName: "sentToHandConfirmed", eventCode: 1212, eventCardUid: search.searchTarget.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: search.mace.uid, eventReasonEffectId: 2, previousLocation: "deck", currentLocation: "hand" },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Mementotlan Mace");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("return Duel.IsMainPhase() and Duel.IsTurnPlayer(1-tp)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,CARD_MEMENTOAL_TECUHTLICA),tp,LOCATION_ONFIELD,0,1,nil)");
  expect(script).toContain("e1:SetCost(Cost.SelfDiscard)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsControlerCanBeChanged),tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY+CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_MEMENTO),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.FaceupFilter(Card.IsSetCard,SET_MEMENTO),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function createRestoredControlField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}) {
  const session = createDuel({ seed: 81945676, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [maceCode, tecuhtlicaCode] }, 1: { main: [controlTargetCode] } });
  startDuel(session);
  const mace = requireCard(session, maceCode);
  const tecuhtlica = requireCard(session, tecuhtlicaCode);
  const controlTarget = requireCard(session, controlTargetCode);
  moveDuelCard(session.state, mace.uid, "hand", 0);
  moveFaceUpAttack(session, tecuhtlica, 0, 0);
  moveFaceUpAttack(session, controlTarget, 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 0;
  const restored = registerAndRestore(session, workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { restored, mace, tecuhtlica, controlTarget };
}

function createRestoredSearchField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}) {
  const session = createDuel({ seed: 81945677, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [maceCode, mementoDestroyCode, searchCode] }, 1: { main: [] } });
  startDuel(session);
  const mace = requireCard(session, maceCode);
  const destroyTarget = requireCard(session, mementoDestroyCode);
  const searchTarget = requireCard(session, searchCode);
  moveFaceUpAttack(session, mace, 0, 0);
  moveFaceUpAttack(session, destroyTarget, 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const restored = registerAndRestore(session, workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { restored, mace, destroyTarget, searchTarget };
}

function registerAndRestore(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, reader: ReturnType<typeof createCardReader>) {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(maceCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(): DuelCardData[] {
  return [
    mementoMonster(maceCode, "Mementotlan Mace", 1200),
    { code: tecuhtlicaCode, name: "Mementoal Tecuhtlica - Combined Creation", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 11, attack: 5000, defense: 5000, setcodes: [setMemento] },
    mementoMonster(mementoDestroyCode, "Mementotlan Mace Destroy Memento", 1000),
    mementoMonster(searchCode, "Mementotlan Mace Search Target", 900),
    { code: controlTargetCode, name: "Mementotlan Mace Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
  ];
}

function mementoMonster(code: string, name: string, attack: number): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect,
    race: raceFiend,
    attribute: attributeDark,
    level: 4,
    attack,
    defense: 1000,
    setcodes: [setMemento],
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
