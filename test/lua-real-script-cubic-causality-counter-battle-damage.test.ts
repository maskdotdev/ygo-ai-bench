import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const causalityCode = "38606913";
const cubicCode = "386069130";
const victimCode = "386069131";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCausalityScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${causalityCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const typeNormal = 0x10;
const raceFiend = 0x8;
const attributeDark = 0x20;
const setCubic = 0xe3;
const cubicCounter = 0x1038;
describe.skipIf(!hasUpstreamScripts || !hasCausalityScript || true)("Lua real script Cubic Causality counter battle damage", () => {
  it("restores Cubic Counter placement, disable locks, grave SelfBanish targeting, and battle-destroy damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${causalityCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const counterSession = createOpenSession(reader, workspace, 38606913);
    const counterCausality = requireCard(counterSession, causalityCode);
    const counterCubic = requireCard(counterSession, cubicCode);
    const counterVictim = requireCard(counterSession, victimCode);
    moveFaceUpAttack(counterSession, counterCubic, 0, 0);
    moveFaceUpAttack(counterSession, counterVictim, 1, 0);
    moveDuelCard(counterSession.state, counterCausality.uid, "spellTrapZone", 0).faceUp = false;
    registerCausality(counterSession, workspace);

    const restoredCounter = restoreDuelWithLuaScripts(serializeDuel(counterSession), workspace, reader);
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 0);
    const activateTrap = getLuaRestoreLegalActions(restoredCounter, 0).find((action) => action.type === "activateEffect" && action.uid === counterCausality.uid);
    expect(activateTrap, JSON.stringify(getLuaRestoreLegalActions(restoredCounter, 0), null, 2)).toBeDefined();
    applyRestored(restoredCounter, activateTrap!);
    passRestoredChain(restoredCounter);
    expect(getDuelCardCounter(restoredCounter.session.state.cards.find((card) => card.uid === counterVictim.uid), cubicCounter)).toBe(1);
    expect(script).toContain("ac:RegisterEffect(e1)");
    expect(script).toContain("ac:RegisterEffect(e2)");

    const battleSession = createOpenSession(reader, workspace, 38606914);
    const graveCausality = requireCard(battleSession, causalityCode);
    const attacker = requireCard(battleSession, cubicCode);
    const victim = requireCard(battleSession, victimCode);
    moveDuelCard(battleSession.state, graveCausality.uid, "graveyard", 0);
    moveFaceUpAttack(battleSession, attacker, 0, 0);
    moveFaceUpAttack(battleSession, victim, 1, 0);
    expect(addDuelCardCounter(victim, cubicCounter, 1)).toBe(true);
    registerCausality(battleSession, workspace);

    const restoredGrave = restoreDuelWithLuaScripts(serializeDuel(battleSession), workspace, reader);
    expectCleanRestore(restoredGrave);
    expectRestoredLegalActions(restoredGrave, 0);
    const markAttacker = getLuaRestoreLegalActions(restoredGrave, 0).find((action) => action.type === "activateEffect" && action.uid === graveCausality.uid);
    expect(markAttacker, JSON.stringify(getLuaRestoreLegalActions(restoredGrave, 0), null, 2)).toBeDefined();
    applyRestored(restoredGrave, markAttacker!);
    passRestoredChain(restoredGrave);
    expect(restoredGrave.session.state.cards.find((card) => card.uid === graveCausality.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveCausality.uid,
      reasonEffectId: 2,
    });
    expect(script).toContain("e1:SetCode(EVENT_LEAVE_FIELD_P)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYING)");

    expect(restoredGrave.session.state.eventHistory.filter((event) => ["becameTarget", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "becameTarget", eventCardUid: attacker.uid, eventPlayer: undefined, eventValue: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2 },
      { eventName: "banished", eventCardUid: graveCausality.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: graveCausality.uid, eventReasonEffectId: 2, relatedEffectId: undefined },
    ]);
    expect(getDuelCardCounter(restoredGrave.session.state.cards.find((card) => card.uid === victim.uid), cubicCounter)).toBe(1);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Cubic Causality");
  expect(script).toContain("s.counter_place_list={0x1038}");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.cfilter,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("ac:AddCounter(0x1038,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SelectTarget(tp,s.tgfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("Duel.RegisterEffect(e2,tp)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("local atk=bt:GetBaseAttack()");
  expect(script).toContain("Duel.Damage(1-tp,atk,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: causalityCode, name: "Cubic Causality", kind: "trap", typeFlags: typeTrap | typeNormal },
    { code: cubicCode, name: "Cubic Causality Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, setcodes: [setCubic], level: 4, attack: 3000, defense: 1000 },
    { code: victimCode, name: "Cubic Causality Victim", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
  ];
}

function createOpenSession(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, seed: number): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [causalityCode, cubicCode] }, 1: { main: [victimCode] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerCausality(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(causalityCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestored(restored, pass!);
  }
}
