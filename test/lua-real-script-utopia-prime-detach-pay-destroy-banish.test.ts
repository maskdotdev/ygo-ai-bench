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
const primeCode = "86532744";
const materialACode = "865327440";
const materialBCode = "865327441";
const materialCCode = "865327442";
const opponentACode = "865327443";
const opponentBCode = "865327444";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPrimeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${primeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPrimeScript)("Lua real script Utopia Prime detach pay destroy banish", () => {
  it("restores three-material detach and pay-to-10 LP cost into destroy-to-banish and count damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${primeCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 86532744, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode, materialCCode], extra: [primeCode] }, 1: { main: [opponentACode, opponentBCode] } });
    startDuel(session);

    const prime = requireCard(session, primeCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const materialC = requireCard(session, materialCCode);
    const opponentA = requireCard(session, opponentACode, 1);
    const opponentB = requireCard(session, opponentBCode, 1);
    moveFaceUpAttack(session, prime, 0);
    prime.summonType = "xyz";
    attachMaterial(session, prime, materialA, 0);
    attachMaterial(session, prime, materialB, 1);
    attachMaterial(session, prime, materialC, 2);
    moveFaceUpAttack(session, opponentA, 1, 0).summonType = "special";
    moveFaceUpAttack(session, opponentB, 1, 1).summonType = "special";
    session.state.players[0].lifePoints = 4000;
    session.state.players[1].lifePoints = 8000;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(primeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    applyRestoredActionAndAssert(restoredOpen, requireAction(restoredOpen, prime.uid, "activateEffect"));
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(findCard(restoredOpen.session, prime.uid)?.overlayUids).toEqual([]);
    expect([materialA, materialB, materialC].map((material) => findCard(restoredOpen.session, material.uid)).map((card) => ({
      location: card.location,
      reason: card.reason,
      reasonCardUid: card.reasonCardUid,
      reasonEffectId: card.reasonEffectId,
      reasonPlayer: card.reasonPlayer,
    }))).toEqual([
      { location: "graveyard", reason: duelReason.cost, reasonCardUid: prime.uid, reasonEffectId: 2, reasonPlayer: 0 },
      { location: "graveyard", reason: duelReason.cost, reasonCardUid: prime.uid, reasonEffectId: 2, reasonPlayer: 0 },
      { location: "graveyard", reason: duelReason.cost, reasonCardUid: prime.uid, reasonEffectId: 2, reasonPlayer: 0 },
    ]);
    expect(findCard(restoredOpen.session, opponentA.uid)).toMatchObject({ location: "banished", controller: 1, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 0, reasonCardUid: prime.uid, reasonEffectId: 2 });
    expect(findCard(restoredOpen.session, opponentB.uid)).toMatchObject({ location: "banished", controller: 1, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 0, reasonCardUid: prime.uid, reasonEffectId: 2 });
    expect(restoredOpen.session.state.players[0].lifePoints).toBe(10);
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(7400);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["detachedMaterial", "lifePointCostPaid", "destroyed", "banished", "breakEffect", "damageDealt"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: materialA.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: prime.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "overlay", current: "graveyard" },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: materialB.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: prime.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "overlay", current: "graveyard" },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: materialC.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: prime.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "overlay", current: "graveyard" },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: materialA.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: prime.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "overlay", current: "graveyard" },
      { eventName: "lifePointCostPaid", eventCode: 1201, eventCardUid: undefined, eventPlayer: 0, eventValue: 3990, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: prime.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentA.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: prime.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentA.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: prime.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "banished" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentB.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: prime.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentB.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: prime.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "banished" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentA.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: prime.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentA.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: prime.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "banished" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: prime.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 1, eventValue: 600, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: prime.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: undefined, current: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const prime = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === primeCode);
  expect(prime).toBeDefined();
  return [
    prime!,
    monster(materialACode, "Utopia Prime Material A", 1000),
    monster(materialBCode, "Utopia Prime Material B", 1000),
    monster(materialCCode, "Utopia Prime Material C", 1000),
    monster(opponentACode, "Utopia Prime Opponent A", 1800),
    monster(opponentBCode, "Utopia Prime Opponent B", 2200),
  ];
}

function monster(code: string, name: string, attack: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack, defense: 1000 };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Number S39: Utopia Prime");
  expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_LIGHT),4,3,s.ovfilter,aux.Stringid(id,0))");
  expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_REMOVE+CATEGORY_DAMAGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("Duel.GetLP(1-tp)>=Duel.GetLP(tp)+3000");
  expect(script).toContain("e1:SetCost(Cost.AND(Cost.DetachFromSelf(3),Cost.PayLP(10,true)))");
  expect(script).toContain("return c:IsSpecialSummoned() and c:IsAbleToRemove()");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT,LOCATION_REMOVED)>0");
  expect(script).toContain("Duel.GetOperatedGroup():FilterCount(s.rmctfilter,nil)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Damage(1-tp,ct*300,REASON_EFFECT)");
}

function attachMaterial(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance, sequence: number): void {
  moveDuelCard(session.state, material.uid, "overlay", holder.controller, duelReason.material | duelReason.xyz, holder.controller).sequence = sequence;
  holder.overlayUids.push(material.uid);
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence = 0): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  return action!;
}

function slimEvent(event: {
  eventName: string;
  eventCode?: number;
  eventCardUid?: string;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventPlayer: event.eventPlayer,
    eventValue: event.eventValue,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    relatedEffectId: event.relatedEffectId,
    previous: event.eventPreviousState?.location,
    current: event.eventCurrentState?.location,
  };
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
