import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const wattcubeCode = "65612454";
const thunderTargetCode = "656124540";
const graveThunderCode = "656124541";
const nonThunderCode = "656124542";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasWattcubeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${wattcubeCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const typeEffect = 0x20;
const raceThunder = 0x2000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasWattcubeScript)("Lua real script Wattcube equip grave count cost stat", () => {
  it("restores equip grave-count ATK and self-to-grave targeted boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${wattcubeCode}.lua`);
    expect(script).toContain("--Wattcube");
    expect(script).toContain("aux.AddEquipProcedure(c,nil,aux.FilterBoolFunction(Card.IsRace,RACE_THUNDER))");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_EQUIP)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("return Duel.GetMatchingGroupCount(Card.IsRace,c:GetControler(),LOCATION_GRAVE,0,nil,RACE_THUNDER)*100");
    expect(script).toContain("e4:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e4:SetRange(LOCATION_SZONE)");
    expect(script).toContain("e4:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e4:SetCost(Cost.SelfToGrave)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1000)");

    const cards: DuelCardData[] = [
      { code: wattcubeCode, name: "Wattcube", kind: "spell", typeFlags: typeSpell | typeEquip },
      { code: thunderTargetCode, name: "Wattcube Thunder Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, level: 4, attack: 1600, defense: 1000 },
      { code: graveThunderCode, name: "Wattcube Grave Thunder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, level: 4, attack: 1000, defense: 1000 },
      { code: nonThunderCode, name: "Wattcube Non-Thunder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 65612454, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wattcubeCode, thunderTargetCode, graveThunderCode, nonThunderCode] }, 1: { main: [] } });
    startDuel(session);

    const wattcube = requireCard(session, wattcubeCode);
    const thunderTarget = requireCard(session, thunderTargetCode);
    const graveThunder = requireCard(session, graveThunderCode);
    const nonThunder = requireCard(session, nonThunderCode);
    moveFaceUpAttack(session, thunderTarget, 0);
    moveFaceUpEquip(session, wattcube, 0, thunderTarget.uid);
    moveDuelCard(session.state, graveThunder.uid, "graveyard", 0);
    moveDuelCard(session.state, nonThunder.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wattcubeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    expect(restoredEquipped.session.state.effects.filter((effect) => effect.sourceUid === wattcube.uid).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      id: effect.id,
      luaConditionDescriptor: effect.luaConditionDescriptor,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      luaCostDescriptor: effect.luaCostDescriptor,
      luaTypeFlags: effect.luaTypeFlags,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 1002, controller: 0, event: "ignition", id: "lua-1-1002", luaConditionDescriptor: undefined, luaCostDescriptor: undefined, luaTargetDescriptor: undefined, luaTypeFlags: 16, range: ["hand", "spellTrapZone"], targetRange: undefined, value: undefined },
      { code: 76, controller: 0, event: "continuous", id: "lua-2-76", luaConditionDescriptor: undefined, luaCostDescriptor: undefined, luaTargetDescriptor: undefined, luaTypeFlags: 1, range: ["spellTrapZone"], targetRange: undefined, value: undefined },
      { code: 100, controller: 0, event: "continuous", id: "lua-3-100", luaConditionDescriptor: undefined, luaCostDescriptor: undefined, luaTargetDescriptor: undefined, luaTypeFlags: 4, range: ["spellTrapZone"], targetRange: undefined, value: undefined },
      { code: undefined, controller: 0, event: "ignition", id: "lua-4", luaConditionDescriptor: undefined, luaCostDescriptor: undefined, luaTargetDescriptor: "target:faceup-race:8192", luaTypeFlags: 64, range: ["spellTrapZone"], targetRange: undefined, value: undefined },
    ]);

    const boost = getLuaRestoreLegalActions(restoredEquipped, 0).find((action) => action.type === "activateEffect" && action.uid === wattcube.uid && action.effectId === "lua-4");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredEquipped, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipped, boost!);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === wattcube.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: wattcube.uid,
      reasonEffectId: 4,
      previousEquippedToUid: thunderTarget.uid,
    });
    resolveRestoredChain(restoredEquipped);
    expect(currentAttack(restoredEquipped.session.state.cards.find((card) => card.uid === thunderTarget.uid), restoredEquipped.session.state)).toBe(2600);
    expect(restoredEquipped.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: wattcube.uid, eventReason: duelReason.cost, eventReasonCardUid: wattcube.uid, eventReasonEffectId: 4, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: thunderTarget.uid, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4 },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4 },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === thunderTarget.uid), restoredStat.session.state)).toBe(2600);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpEquip(session: DuelSession, card: DuelCardInstance, player: 0 | 1, equippedToUid: string): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.equippedToUid = equippedToUid;
  moved.cardTargetUids = [equippedToUid];
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
