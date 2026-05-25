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
const baytalCode = "43932352";
const hecahandsCostCode = "439323520";
const opponentControlTargetCode = "439323521";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBaytalScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${baytalCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const raceIllusion = 0x2000000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const setHecahands = 0x1cc;
const categoryToGrave = 0x20;
const categoryControl = 0x2000;
const eventFreeChain = 1002;
const eventPhaseEnd = 4608;

describe.skipIf(!hasUpstreamScripts || !hasBaytalScript)("Lua real script Baytal Hecahands release control end send", () => {
  it("restores Hecahands release cost into opponent monster control take", () => {
    const { workspace, reader, session } = createFixture(43932352);
    expectScriptShape(workspace.readScript(`official/c${baytalCode}.lua`));
    const baytal = requireCard(session, baytalCode);
    const costMonster = requireCard(session, hecahandsCostCode);
    const opponentTarget = requireCard(session, opponentControlTargetCode);
    moveFaceUpSpell(session, baytal);
    moveFaceUpAttack(session, costMonster, 0, 0);
    moveFaceUpAttack(session, opponentTarget, 1, 0);
    preparePhase(session, "main1", 0, 0);
    registerBaytal(session, workspace);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === baytal.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: eventFreeChain, countLimit: undefined, event: "ignition", id: `lua-1-${eventFreeChain}`, range: ["hand", "spellTrapZone"], triggerEvent: undefined },
      { category: categoryControl, code: eventFreeChain, countLimit: 1, event: "quick", id: `lua-2-${eventFreeChain}`, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: categoryToGrave, code: eventPhaseEnd, countLimit: 1, event: "trigger", id: `lua-3-${eventPhaseEnd}`, range: ["spellTrapZone"], triggerEvent: "phaseEnd" },
    ]);
    expectRestoredLegalActions(restored, 0);
    const control = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === baytal.uid && action.effectId === `lua-2-${eventFreeChain}`
    );
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, control!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, costMonster.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: baytal.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restored.session, opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: baytal.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.eventHistory.filter((event) => ["released", "controlChanged"].includes(event.eventName)).map((event) => ({
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
      { eventName: "released", eventCardUid: costMonster.uid, eventReason: duelReason.release | duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: baytal.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "graveyard", previousController: 0, currentController: 0 },
      { eventName: "controlChanged", eventCardUid: opponentTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: baytal.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "monsterZone", previousController: 1, currentController: 0 },
    ]);
  });

  it("restores End Phase mandatory send of a controlled card to the GY", () => {
    const { workspace, reader, session } = createFixture(43932353);
    const baytal = requireCard(session, baytalCode);
    moveFaceUpSpell(session, baytal);
    preparePhase(session, "main1", 0, 0);
    registerBaytal(session, workspace);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    changePhase(restored, 0, "battle");
    changePhase(restored, 0, "main2");
    changePhase(restored, 0, "end");
    const endSend = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === baytal.uid && action.effectId === `lua-3-${eventPhaseEnd}`
    );
    expect(endSend, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, endSend!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, baytal.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: baytal.uid,
      reasonEffectId: 3,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCardUid: baytal.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: baytal.uid, eventReasonEffectId: 3, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
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
  loadDecks(session, { 0: { main: [baytalCode, hecahandsCostCode] }, 1: { main: [opponentControlTargetCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: baytalCode, name: "Baytal-Hecahands", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: hecahandsCostCode, name: "Baytal-Hecahands Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceIllusion, attribute: attributeDark, setcodes: [setHecahands], level: 4, attack: 1200, defense: 1000 },
    { code: opponentControlTargetCode, name: "Baytal-Hecahands Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Bayt'al-Hecahands");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("return (c:IsSetCard(SET_HECAHANDS) or c:IsOwner(opp)) and Duel.GetMZoneCount(tp,c,tp,LOCATION_REASON_CONTROL)>0");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.ctrlcostfilter,1,false,nil,nil,tp,opp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.ctrlcostfilter,1,1,false,nil,nil,tp,opp)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToChangeControler,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(g,tp)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOGRAVE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToGrave,tp,LOCATION_ONFIELD,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
}

function registerBaytal(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(baytalCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function preparePhase(session: DuelSession, phase: DuelSession["state"]["phase"], turnPlayer: PlayerId, waitingFor: PlayerId): void {
  session.state.phase = phase;
  session.state.turnPlayer = turnPlayer;
  session.state.waitingFor = waitingFor;
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
