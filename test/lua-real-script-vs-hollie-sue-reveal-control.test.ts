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
const hollieCode = "93156774";
const earthRevealCode = "931567740";
const darkRevealCode = "931567741";
const lowTargetCode = "931567742";
const highTargetCode = "931567743";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHollieScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hollieCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeFire = 0x4;
const attributeDark = 0x20;
const setVanquishSoul = 0x196;
const eventFreeChain = 1002;

describe.skipIf(!hasUpstreamScripts || !hasHollieScript)("Lua real script Vanquish Soul Hollie Sue reveal control", () => {
  it("restores EARTH and DARK reveal branch into lowest-ATK opponent control", () => {
    const { workspace, reader, session } = createFixture(93156774);
    expectScriptShape(workspace.readScript(`official/c${hollieCode}.lua`));
    const hollie = requireCard(session, hollieCode);
    const earthReveal = requireCard(session, earthRevealCode);
    const darkReveal = requireCard(session, darkRevealCode);
    const lowTarget = requireCard(session, lowTargetCode);
    const highTarget = requireCard(session, highTargetCode);
    moveFaceUpAttack(session, hollie, 0);
    moveDuelCard(session.state, earthReveal.uid, "hand", 0);
    moveDuelCard(session.state, darkReveal.uid, "hand", 0);
    moveFaceUpAttack(session, lowTarget, 1);
    moveFaceUpAttack(session, highTarget, 1);
    prepareMainPhase(session);
    registerHollie(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === hollie.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      range: effect.range,
    }))).toEqual([
      { category: 0x200, code: eventFreeChain, countLimit: 1, event: "quick", id: `lua-1-${eventFreeChain}`, range: ["hand"] },
      { category: undefined, code: eventFreeChain, countLimit: 1, event: "quick", id: `lua-2-${eventFreeChain}`, range: ["monsterZone"] },
    ]);

    const control = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === hollie.uid && action.effectId === `lua-2-${eventFreeChain}`);
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, control!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.host.promptDecisions.filter((prompt) => prompt.api === "SelectEffect")).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1], descriptions: [1490508386], returned: 1 },
    ]);
    expect(restoredOpen.host.messages).toContain(`confirmed 1: ${earthRevealCode},${darkRevealCode}`);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === lowTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: hollie.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === highTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["confirmed", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "confirmed", eventCardUid: earthReveal.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: [earthReveal.uid, darkReveal.uid], previous: "deck", current: "hand" },
      { eventName: "controlChanged", eventCardUid: lowTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: hollie.uid, eventReasonEffectId: 2, eventUids: undefined, previous: "monsterZone", current: "monsterZone" },
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
  loadDecks(session, { 0: { main: [hollieCode, earthRevealCode, darkRevealCode] }, 1: { main: [lowTargetCode, highTargetCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: hollieCode, name: "Vanquish Soul Hollie Sue", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, setcodes: [setVanquishSoul], level: 5, attack: 500, defense: 2200 },
    { code: earthRevealCode, name: "Hollie Sue EARTH Reveal", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, setcodes: [setVanquishSoul], level: 4, attack: 1200, defense: 1000 },
    { code: darkRevealCode, name: "Hollie Sue DARK Reveal", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, setcodes: [setVanquishSoul], level: 4, attack: 1300, defense: 1000 },
    { code: lowTargetCode, name: "Hollie Sue Low ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
    { code: highTargetCode, name: "Hollie Sue High ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1800, defense: 1000 },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("Vanquish Soul Hollie Sue");
  expect(script).toContain("e1:SetCost(Cost.AND(Cost.HardOncePerChain(id),Cost.Reveal(function(c) return c:IsSetCard(SET_VANQUISH_SOUL) and c:IsMonster() end,true)))");
  expect(script).toContain("e2:SetCost(Cost.HardOncePerChain(id))");
  expect(script).toContain("aux.SelectUnselectGroup(cg1,e,tp,2,2,s.vsrescon,1,tp,HINTMSG_CONFIRM)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("Duel.ShuffleHand(tp)");
  expect(script).toContain("local ming=g:GetMinGroup(Card.GetAttack)");
  expect(script).toContain("Duel.GetControl(sc,tp,PHASE_END,1)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.deckspfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerHollie(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(hollieCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
