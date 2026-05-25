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
const displacedCode = "88083109";
const ownLibromancerCode = "880831090";
const opponentMonsterCode = "880831091";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDisplacedScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${displacedCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeEarth = 0x1;
const setLibromancer = 0x17d;
const categoryToHand = 0x8;
const categoryControl = 0x2000;
const eventFreeChain = 1002;
const eventPhaseEnd = 4608;
const effectFlagCardTarget = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasDisplacedScript)("Lua real script Libromancer Displaced control return", () => {
  it("restores Libromancer return-to-hand into opponent control take and delayed End Phase hand return", () => {
    const { workspace, reader, session } = createFixture(88083109);
    expectScriptShape(workspace.readScript(`official/c${displacedCode}.lua`));
    const displaced = requireCard(session, displacedCode);
    const ownLibromancer = requireCard(session, ownLibromancerCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    setTrap(session, displaced);
    moveFaceUpAttack(session, ownLibromancer, 0, 0);
    moveFaceUpAttack(session, opponentMonster, 1, 0);
    prepareMainPhase(session);
    registerDisplaced(session, workspace);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === displaced.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: categoryToHand | categoryControl, code: eventFreeChain, countLimit: 1, event: "quick", id: `lua-1-${eventFreeChain}`, property: effectFlagCardTarget, range: ["spellTrapZone"] },
    ]);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === displaced.uid && action.effectId === `lua-1-${eventFreeChain}`
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, displaced.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
    });
    expect(findCard(restored.session, ownLibromancer.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: displaced.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restored.session, opponentMonster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: displaced.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.effects.some((effect) =>
      effect.sourceUid === displaced.uid && effect.code === eventPhaseEnd && effect.event === "continuous" && effect.property === 0x80
    )).toBe(true);
    expect(restored.session.state.eventHistory.filter((event) => ["sentToHand", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "sentToHand", eventCardUid: ownLibromancer.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: displaced.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", currentLocation: "hand", previousController: 0, currentController: 0 },
      { eventName: "controlChanged", eventCardUid: opponentMonster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: displaced.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", currentLocation: "monsterZone", previousController: 1, currentController: 0 },
    ]);

    changePhase(restored, 0, "battle");
    changePhase(restored, 0, "main2");
    changePhase(restored, 0, "end");

    expect(findCard(restored.session, opponentMonster.uid)).toMatchObject({
      location: "hand",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: displaced.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToHand").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToHand", eventCardUid: ownLibromancer.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: displaced.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", currentLocation: "hand" },
      { eventName: "sentToHand", eventCardUid: opponentMonster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: displaced.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "hand" },
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
  loadDecks(session, { 0: { main: [displacedCode, ownLibromancerCode] }, 1: { main: [opponentMonsterCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: displacedCode, name: "Libromancer Displaced", kind: "trap", typeFlags: typeTrap },
    { code: ownLibromancerCode, name: "Libromancer Displaced Non-Ritual", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeFire, setcodes: [setLibromancer], level: 4, attack: 1500, defense: 1500 },
    { code: opponentMonsterCode, name: "Libromancer Displaced Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Libromancer Displaced");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,2,2,s.rescon,1,tp,HINTMSG_TARGET)");
  expect(script).toContain("Duel.SetTargetCard(tg)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,hg,1,0,0)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,tg:Filter(Card.IsControler,nil,1-tp),1,0,0)");
  expect(script).toContain("Duel.SendtoHand(tg1,nil,REASON_EFFECT)>0");
  expect(script).toContain("Duel.GetControl(tg2,tp)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("Duel.SendtoHand(e:GetLabelObject(),nil,REASON_EFFECT)");
}

function registerDisplaced(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(displacedCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function setTrap(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
  moved.turnId = 0;
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
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

function changePhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, phase: DuelSession["state"]["phase"]): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
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
