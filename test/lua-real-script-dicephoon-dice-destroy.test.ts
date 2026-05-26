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
const dicephoonCode = "3493058";
const ownTrapCode = "34930580";
const ownSpellCode = "34930581";
const opponentTrapCode = "34930582";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDicephoonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dicephoonCode}.lua`));
const typeSpell = 0x2;
const typeTrap = 0x4;
const categoryDice = 0x2000000;

describe.skipIf(!hasUpstreamScripts || !hasDicephoonScript)("Lua real script Dicephoon dice destroy", () => {
  it("restores deterministic roll-3 branch into selected Spell/Trap destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${dicephoonCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 1, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dicephoonCode, ownTrapCode, ownSpellCode] }, 1: { main: [opponentTrapCode] } });
    startDuel(session);
    const dicephoon = requireCard(session, dicephoonCode);
    const ownTrap = requireCard(session, ownTrapCode);
    const ownSpell = requireCard(session, ownSpellCode);
    const opponentTrap = requireCard(session, opponentTrapCode);
    setBackrow(session, dicephoon, 0, 0);
    setBackrow(session, ownTrap, 0, 1);
    setBackrow(session, ownSpell, 0, 2);
    setBackrow(session, opponentTrap, 1, 0);
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dicephoonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    applyRestoredActionAndAssert(restoredOpen, requireAction(restoredOpen, dicephoon.uid, "activateEffect"));
    expect(restoredOpen.session.state.chain).toEqual([]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 0);
    expect(restoredChain.session.state.lastDiceResults).toEqual([3]);
    expect(findCard(restoredChain.session, ownTrap.uid)).toMatchObject({ location: "graveyard", reason: duelReason.destroy | duelReason.effect, reasonPlayer: 0, reasonCardUid: dicephoon.uid, reasonEffectId: 1 });
    expect(findCard(restoredChain.session, ownSpell.uid)).toMatchObject({ location: "spellTrapZone", controller: 0 });
    expect(findCard(restoredChain.session, opponentTrap.uid)).toMatchObject({ location: "spellTrapZone", controller: 1 });
    expect(restoredChain.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["diceTossed", "destroyed"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "diceTossed", eventCode: 1150, eventCardUid: undefined, eventPlayer: 0, eventValue: 1, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: dicephoon.uid, eventReasonEffectId: 1, previous: undefined, current: undefined },
      destroyedEvent(ownTrap.uid, dicephoon.uid, 0, 1),
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const dicephoon = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === dicephoonCode);
  expect(dicephoon).toBeDefined();
  return [
    dicephoon!,
    { code: ownTrapCode, name: "Dicephoon Own Trap", kind: "trap", typeFlags: typeTrap },
    { code: ownSpellCode, name: "Dicephoon Own Spell", kind: "spell", typeFlags: typeSpell },
    { code: opponentTrapCode, name: "Dicephoon Opponent Trap", kind: "trap", typeFlags: typeTrap },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Dicephoon");
  expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_DAMAGE+CATEGORY_DICE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DICE,nil,0,tp,1)");
  expect(script).toContain("local dc=Duel.TossDice(tp,1)");
  expect(script).toContain("if dc==1 or dc==6 then");
  expect(script).toContain("Duel.Damage(tp,1000,REASON_EFFECT)");
  expect(script).toContain("elseif dc==5 then");
  expect(script).toContain("local g=Duel.GetMatchingGroup(s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,e:GetHandler())");
  expect(script).toContain("local dg=g:Select(tp,2,2,nil)");
  expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,e:GetHandler())");
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

function setBackrow(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDown";
}

function destroyedEvent(cardUid: string, sourceUid: string, controller: PlayerId, sequence: number) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventPlayer: undefined,
    eventValue: undefined,
    eventUids: undefined,
    eventReason: duelReason.destroy | duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    previous: "spellTrapZone",
    current: "graveyard",
  };
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

function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  return action!;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
