import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const marchingCode = "68441986";
const faceupConditionCode = "32453837";
const insectCodes = ["684419860", "684419861"];
const opponentCodes = ["684419862", "684419863"];
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMarchingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${marchingCode}.lua`));
const counterHallucination = 0x1101;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceInsect = 0x800;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasMarchingScript)("Lua real script Ninjitsu Art of Mosquito Marching grave counter disable", () => {
  it("restores grave SelfBanish into opponent Hallucination Counters and disable effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${marchingCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 68441986, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [marchingCode, faceupConditionCode, ...insectCodes] }, 1: { main: opponentCodes } });
    startDuel(session);

    const marching = requireCard(session, marchingCode);
    const faceupCondition = requireCard(session, faceupConditionCode);
    const insects = insectCodes.map((code) => requireCard(session, code));
    const opponents = opponentCodes.map((code) => requireCard(session, code));
    moveDuelCard(session.state, marching.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, faceupCondition, 0, 0);
    insects.forEach((card, index) => moveFaceUpAttack(session, card, 0, index + 1));
    opponents.forEach((card, index) => moveFaceUpAttack(session, card, 1, index));
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(marchingCode), source).ok).toBe(true);
    for (const code of opponentCodes) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === marching.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, marching.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: marching.uid,
      reasonEffectId: 2,
    });
    for (const opponent of opponents) expect(getDuelCardCounter(findCard(restored.session, opponent.uid), counterHallucination)).toBe(1);
    expect(restored.session.state.effects.filter((effect) => opponentCodes.map((code) => requireCard(restored.session, code).uid).includes(effect.sourceUid ?? "") && effect.code === 2).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: 2, event: "continuous", reset: { flags: 33427456 }, sourceUid: opponents[0]!.uid },
      { code: 2, event: "continuous", reset: { flags: 33427456 }, sourceUid: opponents[1]!.uid },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["banished", "becameTarget", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: marching.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: marching.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: opponents[0]!.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: opponents[1]!.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: opponents[0]!.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: marching.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: opponents[1]!.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: marching.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: marchingCode, name: "Ninjitsu Art of Mosquito Marching", kind: "spell", typeFlags: typeSpell },
    { code: faceupConditionCode, name: "Mosquito Marching Face-up Condition", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, level: 4, attack: 1000, defense: 1000 },
    ...insectCodes.map((code, index) => ({ code, name: `Mosquito Marching Insect ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster | typeEffect, race: raceInsect, level: 4, attack: 900, defense: 900 })),
    ...opponentCodes.map((code, index) => ({ code, name: `Mosquito Marching Opponent ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1800, defense: 1000 })),
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (opponentCodes.some((code) => name === `c${code}.lua`)) return "local s,id=GetID(); function s.initial_effect(c) c:EnableCounterPermit(0x1101) end";
      return workspace.readScript(name);
    },
  };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_HAND,0,1,nil,e,tp)");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,1,ft,s.spcheck,1,tp,HINTMSG_SPSUMMON)");
  expect(script).toContain("return sg:GetClassCount(Card.GetLevel)==1");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,32453837),tp,LOCATION_ONFIELD,0,1,nil)");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsRace,RACE_INSECT),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,ct,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,g,1,0,0x1101)");
  expect(script).toContain("local g=Duel.GetTargetCards(e)");
  expect(script).toContain("tc:AddCounter(0x1101,1)");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
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
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
