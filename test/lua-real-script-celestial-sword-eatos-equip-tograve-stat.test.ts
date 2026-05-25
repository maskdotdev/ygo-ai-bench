import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const swordCode = "55569674";
const eatosCode = "34022290";
const banishedCodeOne = "555696740";
const banishedCodeTwo = "555696741";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSwordScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${swordCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const raceWarrior = 0x1;
const raceFairy = 0x4;
const attributeLight = 0x10;
const effectUpdateAttack = 100;
const eventToGrave = 1014;
const allLuaLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasSwordScript)("Lua real script Celestial Sword Eatos equip to-Grave stat", () => {
  it("restores equip ATK and optional to-Grave Guardian Eatos banished-count ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${swordCode}.lua`);
    expect(script).toContain("--Celestial Sword - Eatos");
    expect(script).toContain("aux.AddEquipProcedure(c)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetValue(500)");
    expect(script).toContain("e4:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e4:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e4:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
    expect(script).toContain("return c:IsFaceup() and c:IsCode(34022290)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.GetMatchingGroupCount(s.atkfilter,tp,LOCATION_REMOVED,LOCATION_REMOVED,nil)");
    expect(script).toContain("e1:SetValue(500*ct)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 55569674, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [swordCode, eatosCode, banishedCodeOne] }, 1: { main: [banishedCodeTwo] } });
    startDuel(session);

    const sword = requireCard(session, swordCode);
    const eatos = requireCard(session, eatosCode);
    const banishedOne = requireCard(session, banishedCodeOne);
    const banishedTwo = requireCard(session, banishedCodeTwo);
    moveFaceUpAttack(session, eatos, 0, 0);
    moveFaceUpEquip(session, sword, 0, 0, eatos.uid);
    moveFaceUpBanished(session, banishedOne, 0);
    moveFaceUpBanished(session, banishedTwo, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(swordCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    expect(currentAttack(restoredEquipped.session.state.cards.find((card) => card.uid === eatos.uid), restoredEquipped.session.state)).toBe(3000);
    expect(restoredEquipped.session.state.effects.filter((effect) => effect.sourceUid === sword.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { code: 1002, event: "ignition", property: 134217744, range: ["hand", "spellTrapZone"], triggerEvent: undefined, value: undefined },
      { code: 76, event: "continuous", property: 1024, range: ["spellTrapZone"], triggerEvent: undefined, value: undefined },
      { code: effectUpdateAttack, event: "continuous", property: undefined, range: ["spellTrapZone"], triggerEvent: undefined, value: 500 },
      { code: eventToGrave, event: "trigger", property: 16400, range: allLuaLocations, triggerEvent: "sentToGraveyard", value: undefined },
      { code: 76, event: "continuous", property: 1024, range: ["spellTrapZone"], triggerEvent: undefined, value: undefined },
    ]);

    destroyDuelCard(restoredEquipped.session.state, sword.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === sword.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      previousEquippedToUid: eatos.uid,
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredEquipped.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1014", eventCardUid: sword.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventTriggerTiming: "when", player: 0, sourceUid: sword.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === sword.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === eatos.uid), restoredTrigger.session.state)).toBe(3500);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === eatos.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 33427456 }, value: 1000 },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === eatos.uid), restoredStat.session.state)).toBe(3500);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: swordCode, name: "Celestial Sword - Eatos", kind: "spell", typeFlags: typeSpell | typeEquip },
    { code: eatosCode, name: "Guardian Eatos", kind: "monster", typeFlags: typeMonster, race: raceFairy, attribute: attributeLight, level: 8, attack: 2500, defense: 2000 },
    { code: banishedCodeOne, name: "Celestial Sword Banished One", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: banishedCodeTwo, name: "Celestial Sword Banished Two", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function moveFaceUpEquip(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number, equippedToUid: string): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  moved.equippedToUid = equippedToUid;
  moved.cardTargetUids = [equippedToUid];
}

function moveFaceUpBanished(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "banished", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
