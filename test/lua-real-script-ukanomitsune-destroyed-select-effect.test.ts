import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const ukanomitsuneCode = "49451215";
const ownFieldCode = "494512150";
const opponentFieldCode = "494512151";
const opponentDestroyCode = "494512152";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasUkanomitsuneScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ukanomitsuneCode}.lua`));
const promptOverrides = [{ api: "SelectEffect" as const, player: 0 as const, returned: 3 }];
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeField = 0x80000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasUkanomitsuneScript)("Lua real script Ukanomitsune destroyed SelectEffect", () => {
  it("restores destroyed trigger into SelectEffect both branch, opponent destroy, and 1500 damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${ukanomitsuneCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 49451215, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ownFieldCode], extra: [ukanomitsuneCode] }, 1: { main: [opponentFieldCode, opponentDestroyCode] } });
    startDuel(session);

    const ukanomitsune = requireCard(session, ukanomitsuneCode);
    const ownField = requireCard(session, ownFieldCode);
    const opponentField = requireCard(session, opponentFieldCode, 1);
    const opponentDestroy = requireCard(session, opponentDestroyCode, 1);
    moveFaceUpAttack(session, ukanomitsune, 0);
    ukanomitsune.summonType = "link";
    moveFieldSpell(session, ownField, 0);
    moveFieldSpell(session, opponentField, 1);
    moveFaceUpSpellTrap(session, opponentDestroy, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    expect(host.loadCardScript(Number(ukanomitsuneCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    destroyDuelCard(restoredOpen.session.state, ukanomitsune.uid, 0, duelReason.effect | duelReason.destroy, 1);
    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    expect(restoredDestroyed.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1029", eventCardUid: ukanomitsune.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, player: 0, sourceUid: ukanomitsune.uid, triggerBucket: "turnOptional" },
    ]);
    applyRestoredActionAndAssert(restoredDestroyed, requireTrigger(restoredDestroyed, ukanomitsune.uid, "lua-4-1029"));
    resolveRestoredChain(restoredDestroyed);

    expect(restoredDestroyed.host.promptDecisions.filter((prompt) => prompt.api === "SelectEffect").map((prompt) => ({
      api: prompt.api,
      descriptions: "descriptions" in prompt ? prompt.descriptions : undefined,
      options: "options" in prompt ? prompt.options : undefined,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectEffect", descriptions: [791219442, 791219443, 791219444], options: [1, 2, 3], player: 0, returned: 3 }]);
    expect(findCard(restoredDestroyed.session, opponentDestroy.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 0, reasonCardUid: ukanomitsune.uid, reasonEffectId: 4 });
    expect(findCard(restoredDestroyed.session, ownField.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, sequence: 5 });
    expect(findCard(restoredDestroyed.session, opponentField.uid)).toMatchObject({ location: "spellTrapZone", controller: 1, sequence: 5 });
    expect(restoredDestroyed.session.state.players[1].lifePoints).toBe(6500);
    expect(restoredDestroyed.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard", "breakEffect", "damageDealt"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: ukanomitsune.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: ukanomitsune.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentDestroy.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: ukanomitsune.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: opponentDestroy.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: ukanomitsune.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ukanomitsune.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 1, eventValue: 1500, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ukanomitsune.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: undefined, current: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const ukanomitsune = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === ukanomitsuneCode);
  expect(ukanomitsune).toBeDefined();
  return [
    ukanomitsune!,
    fieldSpell(ownFieldCode, "Ukanomitsune Own Field"),
    fieldSpell(opponentFieldCode, "Ukanomitsune Opponent Field"),
    { code: opponentDestroyCode, name: "Ukanomitsune Opponent Destroy Target", kind: "trap", typeFlags: typeTrap },
  ];
}

function fieldSpell(code: string, name: string): DuelCardData {
  return { code, name, kind: "spell", typeFlags: typeSpell | typeField };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Ukanomitsune-no-Onari");
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_LIGHT),2,2,s.matcheck)");
  expect(script).toContain("e3:SetCategory(CATEGORY_DESTROY+CATEGORY_DAMAGE)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("Duel.GetFieldGroupCount(0,LOCATION_FZONE,LOCATION_FZONE)>0");
  expect(script).toContain("local op=Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.GetFieldGroup(tp,0,LOCATION_ONFIELD)");
  expect(script).toContain("Duel.Destroy(sg,REASON_EFFECT)");
  expect(script).toContain("Duel.Damage(1-tp,1500,REASON_EFFECT)");
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFieldSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = 5;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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

function requireTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, effectId: string): DuelAction {
  const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === uid && candidate.effectId === effectId);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
