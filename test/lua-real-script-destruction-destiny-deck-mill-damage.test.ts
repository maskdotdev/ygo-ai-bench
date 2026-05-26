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
const destinyCode = "62980542";
const milledSpellCode = "629805420";
const milledMonsterCode = "629805421";
const milledTrapCode = "629805422";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDestinyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${destinyCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasDestinyScript)("Lua real script Destruction of Destiny deck mill damage", () => {
  it("restores target-player Deck mill into operated Spell/Trap count damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${destinyCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 62980542, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [destinyCode, milledSpellCode, milledMonsterCode, milledTrapCode] }, 1: { main: [] } });
    startDuel(session);
    const destiny = requireCard(session, destinyCode);
    const spell = requireCard(session, milledSpellCode);
    const monster = requireCard(session, milledMonsterCode);
    const trap = requireCard(session, milledTrapCode);
    moveDuelCard(session.state, destiny.uid, "spellTrapZone", 0);
    destiny.faceUp = false;
    destiny.position = "faceDown";
    destiny.turnId = 0;
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(destinyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === destiny.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 0);

    expect(findCard(restoredChain.session, spell.uid)).toMatchObject({ location: "graveyard", reason: duelReason.effect, reasonPlayer: 0, reasonCardUid: destiny.uid, reasonEffectId: 1 });
    expect(findCard(restoredChain.session, monster.uid)).toMatchObject({ location: "graveyard", reason: duelReason.effect, reasonPlayer: 0, reasonCardUid: destiny.uid, reasonEffectId: 1 });
    expect(findCard(restoredChain.session, trap.uid)).toMatchObject({ location: "graveyard", reason: duelReason.effect, reasonPlayer: 0, reasonCardUid: destiny.uid, reasonEffectId: 1 });
    expect(restoredChain.session.state.players[0].lifePoints).toBe(6000);
    expect(restoredChain.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["sentToGraveyard", "damageDealt"].includes(event.eventName)).map((event) => ({
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
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: trap.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: destiny.uid, eventReasonEffectId: 1, previous: "deck", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: monster.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: destiny.uid, eventReasonEffectId: 1, previous: "deck", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: spell.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: destiny.uid, eventReasonEffectId: 1, previous: "deck", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: trap.uid, eventPlayer: undefined, eventValue: undefined, eventUids: [trap.uid, monster.uid, spell.uid], eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: destiny.uid, eventReasonEffectId: 1, previous: "deck", current: "graveyard" },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 0, eventValue: 2000, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: destiny.uid, eventReasonEffectId: 1, previous: undefined, current: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: destiny.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(restoredAfter.session.state.players[0].lifePoints).toBe(6000);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: destinyCode, name: "Destruction of Destiny", kind: "trap", typeFlags: typeTrap },
    { code: milledSpellCode, name: "Destruction of Destiny Milled Spell", kind: "spell", typeFlags: typeSpell },
    { code: milledMonsterCode, name: "Destruction of Destiny Milled Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: milledTrapCode, name: "Destruction of Destiny Milled Trap", kind: "trap", typeFlags: typeTrap },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Destruction of Destiny");
  expect(script).toContain("e1:SetCategory(CATEGORY_DECKDES+CATEGORY_DAMAGE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
  expect(script).toContain("Duel.IsPlayerCanDiscardDeck(tp,3)");
  expect(script).toContain("Duel.SetTargetPlayer(tp)");
  expect(script).toContain("Duel.SetTargetParam(3)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DECKDES,nil,0,tp,3)");
  expect(script).toContain("return c:IsLocation(LOCATION_GRAVE) and c:IsSpellTrap()");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
  expect(script).toContain("Duel.DiscardDeck(p,val,REASON_EFFECT)");
  expect(script).toContain("local g=Duel.GetOperatedGroup()");
  expect(script).toContain("local ct=g:FilterCount(s.filter,nil)");
  expect(script).toContain("Duel.Damage(tp,ct*1000,REASON_EFFECT)");
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
