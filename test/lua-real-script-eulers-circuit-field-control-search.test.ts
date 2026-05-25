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
const circuitCode = "9547962";
const tindangleOneCode = "95479620";
const tindangleTwoCode = "95479621";
const tindangleThreeCode = "95479622";
const discardCode = "95479623";
const deckCircuitCode = "9547962";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCircuitScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${circuitCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeField = 0x80000;
const raceFiend = 0x8;
const attributeDark = 0x20;
const setTindangle = 0x10b;
const categoryControl = 0x2000;
const categorySearch = 0x20000;
const categoryToHand = 0x8;
const effectCannotAttack = 85;
const eventFreeChain = 1002;
const eventPhaseStandby = 0x1002;
const effectFlagCardTarget = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasCircuitScript)("Lua real script Euler's Circuit field control search", () => {
  it("restores Field Spell metadata, Standby control transfer, and graveyard discard-cost search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${circuitCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const control = createRestoredFieldWindow({ reader, workspace });
    const fieldCircuit = requireZoneCard(control.session, circuitCode, "spellTrapZone");
    const target = requireCard(control.session, tindangleOneCode);
    expectCleanRestore(control);
    expect(control.session.state.effects.filter((effect) => effect.sourceUid === fieldCircuit.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: eventFreeChain, countLimit: undefined, event: "ignition", property: undefined, range: ["hand", "spellTrapZone"], targetRange: undefined, triggerEvent: undefined },
      { category: undefined, code: effectCannotAttack, countLimit: undefined, event: "continuous", property: undefined, range: ["spellTrapZone"], targetRange: [0, 4], triggerEvent: undefined },
      { category: categoryControl, code: eventPhaseStandby, countLimit: 1, event: "trigger", property: effectFlagCardTarget, range: ["spellTrapZone"], targetRange: undefined, triggerEvent: "phaseStandby" },
      { category: categoryToHand | categorySearch, code: undefined, countLimit: 1, event: "ignition", property: undefined, range: ["graveyard"], targetRange: undefined, triggerEvent: undefined },
    ]);
    expectRestoredLegalActions(control, 0);
    control.session.state.phase = "draw";
    control.session.state.turnPlayer = 0;
    control.session.state.waitingFor = 0;
    changePhase(control, 0, "standby");

    const standby = restoreDuelWithLuaScripts(serializeDuel(control.session), workspace, reader);
    expectCleanRestore(standby);
    expectRestoredLegalActions(standby, 0);
    const controlTrigger = getLuaRestoreLegalActions(standby, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === fieldCircuit.uid && action.effectId === "lua-3-4098"
    );
    expect(controlTrigger, JSON.stringify(getLuaRestoreLegalActions(standby, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(standby, controlTrigger!);

    const controlChain = restoreDuelWithLuaScripts(serializeDuel(standby.session), workspace, reader);
    expectCleanRestore(controlChain);
    expectRestoredLegalActions(controlChain, 1);
    resolveRestoredChain(controlChain);
    expect(controlChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: fieldCircuit.uid,
      reasonEffectId: 3,
    });

    const search = createRestoredGraveSearchWindow({ reader, workspace });
    const graveCircuit = requireZoneCard(search.session, circuitCode, "graveyard");
    const discard = requireCard(search.session, discardCode);
    expectCleanRestore(search);
    expectRestoredLegalActions(search, 0);
    const searchAction = getLuaRestoreLegalActions(search, 0).find((action) =>
      action.type === "activateEffect" && action.uid === graveCircuit.uid && action.effectId === "lua-4"
    );
    expect(searchAction, JSON.stringify(getLuaRestoreLegalActions(search, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(search, searchAction!);
    resolveRestoredChain(search);
    const searchedCircuit = search.session.state.cards.find((card) => card.code === deckCircuitCode && card.uid !== graveCircuit.uid);
    expect(searchedCircuit).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveCircuit.uid,
      reasonEffectId: 4,
    });
    expect(search.session.state.cards.find((card) => card.uid === graveCircuit.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveCircuit.uid,
      reasonEffectId: 4,
    });
    expect(search.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: graveCircuit.uid,
      reasonEffectId: 4,
    });
  });
});

function createRestoredFieldWindow({ reader, workspace }: { reader: ReturnType<typeof createCardReader>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> }): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = baseSession(reader, 9547962, { 0: { main: [circuitCode, tindangleOneCode, tindangleTwoCode, tindangleThreeCode] }, 1: { main: [] } });
  const circuit = moveDuelCard(session.state, requireCard(session, circuitCode).uid, "spellTrapZone", 0);
  circuit.faceUp = true;
  moveFaceUpAttack(session, requireCard(session, tindangleOneCode), 0);
  moveFaceUpAttack(session, requireCard(session, tindangleTwoCode), 0);
  moveFaceUpAttack(session, requireCard(session, tindangleThreeCode), 0);
  return registerAndRestore(session, workspace, reader, 1);
}

function createRestoredGraveSearchWindow({ reader, workspace }: { reader: ReturnType<typeof createCardReader>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> }): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = baseSession(reader, 9547963, { 0: { main: [circuitCode, circuitCode, discardCode] }, 1: { main: [] } });
  const circuits = session.state.cards.filter((card) => card.code === circuitCode);
  expect(circuits).toHaveLength(2);
  moveDuelCard(session.state, circuits[0]!.uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, discardCode).uid, "hand", 0);
  return registerAndRestore(session, workspace, reader, 2);
}

function baseSession(reader: ReturnType<typeof createCardReader>, seed: number, decks: Parameters<typeof loadDecks>[1]): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, decks);
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerAndRestore(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, reader: ReturnType<typeof createCardReader>, effectCount: number): ReturnType<typeof restoreDuelWithLuaScripts> {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(circuitCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(effectCount);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Euler's Circuit");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_TINDANGLE),e:GetHandlerPlayer(),LOCATION_MZONE,0,3,nil)");
  expect(script).toContain("e3:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("return Duel.IsTurnPlayer(tp)");
  expect(script).toContain("Duel.SelectTarget(tp,s.ctfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,1-tp)");
  expect(script).toContain("Duel.Remove(e:GetHandler(),POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.DiscardHand(tp,s.cfilter,1,1,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("Duel.GetFirstMatchingCard(s.filter,tp,LOCATION_DECK,0,nil)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: circuitCode, name: "Euler's Circuit", kind: "spell", typeFlags: typeSpell | typeField },
    { code: tindangleOneCode, name: "Euler Tindangle One", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, setcodes: [setTindangle], level: 4, attack: 1600, defense: 1000 },
    { code: tindangleTwoCode, name: "Euler Tindangle Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, setcodes: [setTindangle], level: 4, attack: 1500, defense: 1000 },
    { code: tindangleThreeCode, name: "Euler Tindangle Three", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, setcodes: [setTindangle], level: 4, attack: 1400, defense: 1000 },
    { code: discardCode, name: "Euler Tindangle Discard", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, setcodes: [setTindangle], level: 4, attack: 1300, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireZoneCard(session: DuelSession, code: string, location: DuelCardInstance["location"]): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.location === location);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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

function changePhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, phase: DuelSession["state"]["phase"]): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
}
