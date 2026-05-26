import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const mandalaCode = "8837932";
const cubicAllyCode = "88379320";
const destroyedOpponentCode = "88379321";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMandalaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mandalaCode}.lua`));
const setCubic = 0xe3;
const counterCubic = 0x1038;
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeContinuous = 0x20000;

describe.skipIf(!hasUpstreamScripts || !hasMandalaScript)("Lua real script Cubic Mandala grave SpecialSummonStep counter disable", () => {
  it("restores activation target into opponent SpecialSummonStep operated Cubic Counter and disable locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${mandalaCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 8837932, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mandalaCode, cubicAllyCode] }, 1: { main: [destroyedOpponentCode] } });
    startDuel(session);

    const mandala = requireCard(session, mandalaCode, 0);
    const cubicAlly = requireCard(session, cubicAllyCode, 0);
    const destroyedOpponent = requireCard(session, destroyedOpponentCode, 1);
    moveSetTrap(session, mandala);
    moveFaceUpAttack(session, cubicAlly, 0);
    moveDestroyedThisTurnToGrave(session, destroyedOpponent);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(mandalaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(destroyedOpponentCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === mandala.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);
    resolveRestoredChain(restored);

    const summoned = findCard(restored.session, destroyedOpponent.uid);
    expect(summoned).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: mandala.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restored.session, mandala.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });
    expect(findCard(restored.session, mandala.uid).cardTargetUids).toEqual([destroyedOpponent.uid]);
    expect(currentAttack(summoned, restored.session.state)).toBe(0);
    expect(getDuelCardCounter(summoned, counterCubic)).toBe(1);
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "specialSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: destroyedOpponent.uid, eventCode: 1028, eventName: "becameTarget", eventReason: duelReason.destroy | duelReason.effect, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: destroyedOpponent.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: mandala.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: destroyedOpponent.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: mandala.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
    ]);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === destroyedOpponent.uid && effect.code !== undefined && [102, 85, 2].includes(effect.code)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: 102, event: "continuous", reset: { flags: 33427456 }, sourceUid: destroyedOpponent.uid },
      { code: 85, event: "continuous", reset: { flags: 33427456 }, sourceUid: destroyedOpponent.uid },
      { code: 2, event: "continuous", reset: { flags: 33427456 }, sourceUid: destroyedOpponent.uid },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: mandalaCode, name: "Cubic Mandala", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: cubicAllyCode, name: "Cubic Mandala Cubic Ally", kind: "monster", typeFlags: typeMonster, setcodes: [setCubic], level: 4, attack: 1200, defense: 1000 },
    { code: destroyedOpponentCode, name: "Cubic Mandala Destroyed Opponent", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${destroyedOpponentCode}.lua`) return "local s,id=GetID(); function s.initial_effect(c) c:EnableCounterPermit(0x1038) end";
      return workspace.readScript(name);
    },
  };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_CUBIC),tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("c:IsReason(REASON_DESTROY) and c:IsMonster() and c:GetTurnID()==tid");
  expect(script).toContain("Duel.IsCanAddCounter(tp,COUNTER_CUBIC,1,c)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,0,LOCATION_GRAVE,1,ft,nil,e,tp,tid)");
  expect(script).toContain("Duel.SpecialSummonStep(sc,0,tp,1-tp,false,false,POS_FACEUP)");
  expect(script).toContain("c:SetCardTarget(sc)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
  expect(script).toContain("local og=Duel.GetOperatedGroup()");
  expect(script).toContain("oc:AddCounter(COUNTER_CUBIC,1)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e3:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EVENT_CHAIN_ACTIVATING)");
  expect(script).toContain("Duel.NegateEffect(ev)");
  expect(script).toContain("e3:SetCode(EVENT_LEAVE_FIELD)");
  expect(script).toContain("Duel.Destroy(e:GetHandler(),REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string, owner: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveSetTrap(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
  moved.turnId = 0;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveDestroyedThisTurnToGrave(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "graveyard", card.owner);
  moved.reason = duelReason.destroy | duelReason.effect;
  moved.reasonPlayer = 0;
  moved.turnId = session.state.turn;
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
