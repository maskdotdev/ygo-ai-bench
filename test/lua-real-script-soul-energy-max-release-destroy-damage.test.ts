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
const soulEnergyCode = "79339613";
const obeliskCode = "10000000";
const releaseACode = "793396130";
const releaseBCode = "793396131";
const opponentACode = "793396132";
const opponentBCode = "793396133";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSoulEnergyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${soulEnergyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSoulEnergyScript)("Lua real script Soul Energy MAX release destroy damage", () => {
  it("restores Obelisk-gated two-monster release cost into opponent field destruction and 4000 damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${soulEnergyCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 79339613, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [soulEnergyCode, obeliskCode, releaseACode, releaseBCode] }, 1: { main: [opponentACode, opponentBCode] } });
    startDuel(session);

    const soulEnergy = requireCard(session, soulEnergyCode);
    const obelisk = requireCard(session, obeliskCode);
    const releaseA = requireCard(session, releaseACode);
    const releaseB = requireCard(session, releaseBCode);
    const opponentA = requireCard(session, opponentACode, 1);
    const opponentB = requireCard(session, opponentBCode, 1);
    const setSoulEnergy = moveDuelCard(session.state, soulEnergy.uid, "spellTrapZone", 0);
    setSoulEnergy.faceUp = false;
    setSoulEnergy.position = "faceDown";
    setSoulEnergy.turnId = 0;
    moveFaceUpAttack(session, obelisk, 0, 0);
    moveFaceUpAttack(session, releaseA, 0, 1);
    moveFaceUpAttack(session, releaseB, 0, 2);
    moveFaceUpAttack(session, opponentA, 1, 0);
    moveFaceUpAttack(session, opponentB, 1, 1);
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(soulEnergyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    applyRestoredActionAndAssert(restoredOpen, requireAction(restoredOpen, soulEnergy.uid, "activateEffect"));
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(findCard(restoredOpen.session, soulEnergy.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.rule });
    expect(findCard(restoredOpen.session, obelisk.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(findCard(restoredOpen.session, releaseA.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.cost | duelReason.release, reasonPlayer: 0, reasonCardUid: soulEnergy.uid, reasonEffectId: 1 });
    expect(findCard(restoredOpen.session, releaseB.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.cost | duelReason.release, reasonPlayer: 0, reasonCardUid: soulEnergy.uid, reasonEffectId: 1 });
    expect(findCard(restoredOpen.session, opponentA.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 0, reasonCardUid: soulEnergy.uid, reasonEffectId: 1 });
    expect(findCard(restoredOpen.session, opponentB.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 0, reasonCardUid: soulEnergy.uid, reasonEffectId: 1 });
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(4000);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["released", "destroyed", "sentToGraveyard", "damageDealt"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: releaseA.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: soulEnergy.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "released", eventCode: 1017, eventCardUid: releaseB.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: soulEnergy.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: releaseB.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: soulEnergy.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "released", eventCode: 1017, eventCardUid: releaseA.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: soulEnergy.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentA.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: soulEnergy.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: opponentA.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: soulEnergy.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentB.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: soulEnergy.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: opponentB.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: soulEnergy.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentA.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: soulEnergy.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 1, eventValue: 4000, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: soulEnergy.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: soulEnergy.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const dbCards = workspace.readDatabaseCards("cards.cdb");
  const soulEnergy = dbCards.find((card) => card.code === soulEnergyCode);
  const obelisk = dbCards.find((card) => card.code === obeliskCode);
  expect(soulEnergy).toBeDefined();
  expect(obelisk).toBeDefined();
  return [
    soulEnergy!,
    obelisk!,
    monster(releaseACode, "Soul Energy Release A", 1000),
    monster(releaseBCode, "Soul Energy Release B", 1100),
    monster(opponentACode, "Soul Energy Opponent A", 1800),
    monster(opponentBCode, "Soul Energy Opponent B", 2200),
  ];
}

function monster(code: string, name: string, attack: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack, defense: 1000 };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Soul Energy MAX!!!");
  expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_DAMAGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("return Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_ONFIELD,0,1,nil)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,Card.IsFaceup,2,false,s.check,nil)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,Card.IsFaceup,2,2,false,s.check,nil)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.GetFieldGroup(tp,0,LOCATION_MZONE)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)>0");
  expect(script).toContain("Duel.Damage(1-tp,4000,REASON_EFFECT)");
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
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
