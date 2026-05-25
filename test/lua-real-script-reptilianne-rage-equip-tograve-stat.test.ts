import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentRace } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const rageCode = "91580102";
const equippedCode = "915801020";
const targetCode = "915801021";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRageScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rageCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const raceWarrior = 0x1;
const raceReptile = 0x80000;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const effectChangeRace = 122;
const eventToGrave = 1014;
const allLuaLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasRageScript)("Lua real script Reptilianne Rage equip to-Grave stat", () => {
  it("restores equip ATK/race effects and destroyed-to-Grave target ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rageCode}.lua`);
    expect(script).toContain("--Reptilianne Rage");
    expect(script).toContain("aux.AddEquipProcedure(c)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetValue(800)");
    expect(script).toContain("e3:SetCode(EFFECT_CHANGE_RACE)");
    expect(script).toContain("e3:SetValue(RACE_REPTILE)");
    expect(script).toContain("e5:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("e5:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return e:GetHandler():IsReason(REASON_DESTROY)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("e1:SetValue(-800)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 91580102, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rageCode, equippedCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const rage = requireCard(session, rageCode);
    const equipped = requireCard(session, equippedCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, equipped, 0, 0);
    moveFaceUpAttack(session, target, 1, 0);
    moveFaceUpEquip(session, rage, 0, 0, equipped.uid);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rageCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    expect(currentAttack(restoredEquipped.session.state.cards.find((card) => card.uid === equipped.uid), restoredEquipped.session.state)).toBe(1800);
    expect(currentRace(restoredEquipped.session.state.cards.find((card) => card.uid === equipped.uid), restoredEquipped.session.state)).toBe(raceReptile);
    expect(restoredEquipped.session.state.effects.filter((effect) => effect.sourceUid === rage.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { code: 1002, event: "ignition", range: ["hand", "spellTrapZone"], triggerEvent: undefined, value: undefined },
      { code: 76, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined, value: undefined },
      { code: effectUpdateAttack, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined, value: 800 },
      { code: effectChangeRace, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined, value: raceReptile },
      { code: eventToGrave, event: "trigger", range: allLuaLocations, triggerEvent: "sentToGraveyard", value: undefined },
    ]);

    destroyDuelCard(restoredEquipped.session.state, rage.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === rage.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      previousEquippedToUid: equipped.uid,
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredEquipped.session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-5-1014", eventCardUid: rage.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, player: 0, sourceUid: rage.uid, triggerBucket: "turnMandatory" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === rage.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid), restoredTrigger.session.state)).toBe(1200);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 33427456 }, value: -800 },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === target.uid), restoredStat.session.state)).toBe(1200);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === equipped.uid), restoredStat.session.state)).toBe(1000);
    expect(currentRace(restoredStat.session.state.cards.find((card) => card.uid === equipped.uid), restoredStat.session.state)).toBe(raceWarrior);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: rageCode, name: "Reptilianne Rage", kind: "spell", typeFlags: typeSpell | typeEquip },
    { code: equippedCode, name: "Reptilianne Rage Equipped Monster", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: targetCode, name: "Reptilianne Rage Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
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
