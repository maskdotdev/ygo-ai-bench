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
const steamTrainCode = "17775525";
const ownSpellCode = "177755250";
const opponentTrapCode = "177755251";
const ownMonsterCode = "177755252";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSteamTrainScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${steamTrainCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeTrap = 0x4;
const raceMachine = 0x20;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSteamTrainScript)("Lua real script Steam Train King grave banish damage", () => {
  it("restores graveyard Spell/Trap group banish into count-based effect damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${steamTrainCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 17775525, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ownSpellCode, ownMonsterCode], extra: [steamTrainCode] }, 1: { main: [opponentTrapCode] } });
    startDuel(session);

    const steamTrain = requireCard(session, steamTrainCode);
    const ownSpell = requireCard(session, ownSpellCode);
    const ownMonster = requireCard(session, ownMonsterCode);
    const opponentTrap = requireCard(session, opponentTrapCode, 1);
    moveFaceUpAttack(session, steamTrain, 0);
    steamTrain.summonType = "synchro";
    moveDuelCard(session.state, ownSpell.uid, "graveyard", 0);
    moveDuelCard(session.state, ownMonster.uid, "graveyard", 0);
    moveDuelCard(session.state, opponentTrap.uid, "graveyard", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(steamTrainCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    applyRestoredActionAndAssert(restoredOpen, requireAction(restoredOpen, steamTrain.uid, "activateEffect"));
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(findCard(restoredOpen.session, ownSpell.uid)).toMatchObject({ location: "banished", controller: 0, reason: duelReason.effect, reasonPlayer: 0, reasonCardUid: steamTrain.uid, reasonEffectId: 5 });
    expect(findCard(restoredOpen.session, opponentTrap.uid)).toMatchObject({ location: "banished", controller: 1, reason: duelReason.effect, reasonPlayer: 0, reasonCardUid: steamTrain.uid, reasonEffectId: 5 });
    expect(findCard(restoredOpen.session, ownMonster.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(7600);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["banished", "damageDealt"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: ownSpell.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: steamTrain.uid, eventReasonEffectId: 5, relatedEffectId: undefined, previous: "graveyard", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentTrap.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: steamTrain.uid, eventReasonEffectId: 5, relatedEffectId: undefined, previous: "graveyard", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: ownSpell.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: steamTrain.uid, eventReasonEffectId: 5, relatedEffectId: undefined, previous: "graveyard", current: "banished" },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 1, eventValue: 400, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: steamTrain.uid, eventReasonEffectId: 5, relatedEffectId: undefined, previous: undefined, current: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const steamTrain = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === steamTrainCode);
  expect(steamTrain).toBeDefined();
  return [
    steamTrain!,
    { code: ownSpellCode, name: "Steam Train Grave Spell", kind: "spell", typeFlags: typeSpell },
    { code: opponentTrapCode, name: "Steam Train Opponent Grave Trap", kind: "trap", typeFlags: typeTrap },
    { code: ownMonsterCode, name: "Steam Train Grave Monster Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Superheavy Samurai Steam Train King");
  expect(script).toContain("e1:SetCode(EFFECT_DEFENSE_ATTACK)");
  expect(script).toContain("e3:SetCategory(CATEGORY_REMOVE+CATEGORY_DAMAGE)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("return c:IsSpellTrap() and c:IsAbleToRemove()");
  expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_GRAVE,LOCATION_GRAVE,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,#g*200)");
  expect(script).toContain("local ct=Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("Duel.Damage(1-tp,ct*200,REASON_EFFECT)");
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
