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
const decisiveCode = "9888196";
const handCostCode = "98881960";
const opponentFieldLightCode = "98881961";
const opponentHandLightCode = "98881962";
const opponentHandDarkCode = "98881963";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDecisiveScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${decisiveCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDecisiveScript)("Lua real script Ally of Justice Decisive Armor hand destruction damage", () => {
  it("restores all-hand Graveyard cost into opponent hand confirmation, LIGHT send, and ATK damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${decisiveCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 9888196, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [handCostCode], extra: [decisiveCode] }, 1: { main: [opponentFieldLightCode, opponentHandLightCode, opponentHandDarkCode] } });
    startDuel(session);

    const decisive = requireCard(session, decisiveCode);
    const handCost = requireCard(session, handCostCode);
    const opponentFieldLight = requireCard(session, opponentFieldLightCode);
    const opponentHandLight = requireCard(session, opponentHandLightCode);
    const opponentHandDark = requireCard(session, opponentHandDarkCode);
    moveFaceUpAttack(session, decisive, 0, 0);
    moveDuelCard(session.state, handCost.uid, "hand", 0);
    moveFaceUpAttack(session, opponentFieldLight, 1, 0);
    moveDuelCard(session.state, opponentHandLight.uid, "hand", 1);
    moveDuelCard(session.state, opponentHandDark.uid, "hand", 1);
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(decisiveCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const handes = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === decisive.uid && action.effectId === "lua-5");
    expect(handes, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, handes!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(findCard(restoredOpen.session, handCost.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.cost });
    expect(findCard(restoredOpen.session, opponentHandLight.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.effect });
    expect(findCard(restoredOpen.session, opponentHandDark.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredOpen.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(6300);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToGraveyard", "confirmed", "damageDealt"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: handCost.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: decisive.uid, eventReasonEffectId: 5, previous: "hand", current: "graveyard" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: opponentHandLight.uid, eventPlayer: 0, eventValue: 2, eventUids: [opponentHandLight.uid, opponentHandDark.uid], eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "hand" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: opponentHandLight.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: decisive.uid, eventReasonEffectId: 5, previous: "hand", current: "graveyard" },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 1, eventValue: 1700, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: decisive.uid, eventReasonEffectId: 5, previous: undefined, current: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const decisive = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === decisiveCode);
  expect(decisive).toBeDefined();
  return [
    decisive!,
    monster(handCostCode, "Decisive Armor Hand Cost", attributeDark, 1000),
    monster(opponentFieldLightCode, "Decisive Armor Opponent Field LIGHT", attributeLight, 1200),
    monster(opponentHandLightCode, "Decisive Armor Opponent Hand LIGHT", attributeLight, 1700),
    monster(opponentHandDarkCode, "Decisive Armor Opponent Hand DARK", attributeDark, 1300),
  ];
}

function monster(code: string, name: string, attribute: number, attack: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute, level: 4, attack, defense: 1000 };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Ally of Justice Decisive Armor");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),2,99)");
  expect(script).toContain("return c:IsFaceup() and c:IsAttribute(ATTRIBUTE_LIGHT)");
  expect(script).toContain("e3:SetCategory(CATEGORY_HANDES+CATEGORY_TOGRAVE+CATEGORY_DAMAGE)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e3:SetCountLimit(1,0,EFFECT_COUNT_CODE_SINGLE)");
  expect(script).toContain("e3:SetRange(LOCATION_MZONE)");
  expect(script).toContain("Duel.GetFieldGroup(tp,LOCATION_HAND,0)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("Duel.GetFieldGroup(tp,0,LOCATION_HAND)");
  expect(script).toContain("Duel.ConfirmCards(tp,g)");
  expect(script).toContain("local sg=g:Filter(Card.IsAttribute,nil,ATTRIBUTE_LIGHT)");
  expect(script).toContain("Duel.SendtoGrave(sg,REASON_EFFECT)");
  expect(script).toContain("atk=atk+tatk");
  expect(script).toContain("Duel.Damage(1-tp,atk,REASON_EFFECT)");
  expect(script).toContain("Duel.ShuffleHand(1-tp)");
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  if (card.code === decisiveCode) moved.summonType = "synchro";
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

function slimEvent(event: {
  eventName: string;
  eventCode?: number;
  eventCardUid?: string;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventUids?: string[];
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventPlayer: event.eventPlayer,
    eventValue: event.eventValue,
    eventUids: event.eventUids,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
