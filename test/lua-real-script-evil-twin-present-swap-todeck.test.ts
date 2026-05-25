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
const presentCode = "60759087";
const kisikilCode = "607590870";
const lillaCode = "607590871";
const opponentMonsterCode = "607590872";
const opponentSetSpellCode = "607590873";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPresentScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${presentCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;
const setKiSikil = 0x153;
const setLilLa = 0x154;
const categoryToDeck = 0x10;
const categoryControl = 0x2000;
const eventFreeChain = 1002;
const effectFlagCardTarget = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasPresentScript)("Lua real script Evil Twin Present swap to Deck", () => {
  it("restores Ki-sikil/Lil-la condition into targeted monster SwapControl", () => {
    const { workspace, reader, session } = createFixture(60759087);
    expectScriptShape(workspace.readScript(`official/c${presentCode}.lua`));
    const present = requireCard(session, presentCode);
    const kisikil = requireCard(session, kisikilCode);
    const lilla = requireCard(session, lillaCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    setPresent(session, present);
    moveFaceUpAttack(session, kisikil, 0, 0);
    moveFaceUpAttack(session, lilla, 0, 1);
    moveFaceUpAttack(session, opponentMonster, 1, 0);
    prepareMainPhase(session);
    registerPresent(session, workspace);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === present.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: categoryControl, code: eventFreeChain, countLimit: 1, event: "quick", id: `lua-1-${eventFreeChain}`, property: effectFlagCardTarget, range: ["spellTrapZone"] },
      { category: categoryToDeck, code: eventFreeChain, countLimit: 1, event: "quick", id: `lua-2-${eventFreeChain}`, property: effectFlagCardTarget, range: ["spellTrapZone"] },
    ]);

    const swap = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === present.uid && action.effectId === `lua-1-${eventFreeChain}`
    );
    expect(swap, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, swap!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, kisikil.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: present.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restored.session, opponentMonster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: present.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restored.session, lilla.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    const controlEvents = restored.session.state.eventHistory.filter((event) => event.eventName === "controlChanged").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }));
    expect(controlEvents).toContainEqual({ eventName: "controlChanged", eventCardUid: kisikil.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: present.uid, eventReasonEffectId: 1, previousController: 0, currentController: 1 });
    expect(controlEvents).toContainEqual({ eventName: "controlChanged", eventCardUid: opponentMonster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: present.uid, eventReasonEffectId: 1, previousController: 1, currentController: 0 });
  });

  it("restores cloned activation into targeted set Spell/Trap shuffle", () => {
    const { workspace, reader, session } = createFixture(60759088);
    const present = requireCard(session, presentCode);
    const kisikil = requireCard(session, kisikilCode);
    const lilla = requireCard(session, lillaCode);
    const opponentSetSpell = requireCard(session, opponentSetSpellCode);
    setPresent(session, present);
    moveFaceUpAttack(session, kisikil, 0, 0);
    moveFaceUpAttack(session, lilla, 0, 1);
    const setSpell = moveDuelCard(session.state, opponentSetSpell.uid, "spellTrapZone", 1);
    setSpell.faceUp = false;
    setSpell.position = "faceDown";
    prepareMainPhase(session);
    registerPresent(session, workspace);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const toDeck = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === present.uid && action.effectId === `lua-2-${eventFreeChain}`
    );
    expect(toDeck, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, toDeck!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, opponentSetSpell.uid)).toMatchObject({
      location: "deck",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: present.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToDeck").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToDeck", eventCardUid: opponentSetSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: present.uid, eventReasonEffectId: 2, previousLocation: "spellTrapZone", currentLocation: "deck" },
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
  loadDecks(session, { 0: { main: [presentCode, kisikilCode, lillaCode] }, 1: { main: [opponentMonsterCode, opponentSetSpellCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: presentCode, name: "Evil Twin Present", kind: "trap", typeFlags: typeTrap },
    { code: kisikilCode, name: "Evil Twin Present Ki-sikil", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, setcodes: [setKiSikil], level: 4, attack: 1100, defense: 1000 },
    { code: lillaCode, name: "Evil Twin Present Lil-la", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, setcodes: [setLilLa], level: 4, attack: 500, defense: 1000 },
    { code: opponentMonsterCode, name: "Evil Twin Present Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
    { code: opponentSetSpellCode, name: "Evil Twin Present Opponent Set Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Evil★Twin Present");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("Duel.GetFieldGroup(tp,LOCATION_MZONE,0):Filter(Card.IsFaceup,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter1,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter2,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SwapControl(a,b)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TODECK)");
  expect(script).toContain("return c:IsFacedown() and c:IsSpellTrap() and c:IsAbleToDeck()");
  expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
}

function setPresent(session: DuelSession, present: DuelCardInstance): void {
  const setCard = moveDuelCard(session.state, present.uid, "spellTrapZone", 0);
  setCard.faceUp = false;
  setCard.position = "faceDown";
  setCard.turnId = 0;
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerPresent(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(presentCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.position = "faceUpAttack";
  moved.faceUp = true;
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
