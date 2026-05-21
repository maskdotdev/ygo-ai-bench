import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hexeCode = "46294982";
const castleCode = "72283691";
const firstTargetCode = "462949820";
const secondTargetCode = "462949821";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHexeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hexeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeField = 0x80000;
const raceSpellcaster = 0x10;
const raceWarrior = 0x1;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasHexeScript)("Lua real script Hexe Trude destroy extra battle stat", () => {
  it("restores Golden Castle destroy into monster-only extra attack and battle-destroying ATK trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${hexeCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 46294982, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hexeCode, castleCode] }, 1: { main: [firstTargetCode, secondTargetCode] } });
    startDuel(session);

    const hexe = requireCard(session, hexeCode);
    const castle = requireCard(session, castleCode);
    const firstTarget = requireCard(session, firstTargetCode);
    const secondTarget = requireCard(session, secondTargetCode);
    moveFaceUpAttack(session, hexe, 0);
    moveDuelCard(session.state, castle.uid, "spellTrapZone", 0).faceUp = true;
    moveFaceUpAttack(session, firstTarget, 1);
    moveFaceUpAttack(session, secondTarget, 1);
    secondTarget.sequence = 1;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hexeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredIgnitionOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredIgnitionOpen);
    expectRestoredLegalActions(restoredIgnitionOpen, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnitionOpen, 0).find((action) => action.type === "activateEffect" && action.uid === hexe.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnitionOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnitionOpen, ignition!);
    passRestoredChain(restoredIgnitionOpen);

    expect(restoredIgnitionOpen.session.state.cards.find((card) => card.uid === castle.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: hexe.uid,
      reasonEffectId: 2,
    });
    expect(restoredIgnitionOpen.session.state.effects.filter((effect) => effect.sourceUid === hexe.uid && effect.code === 346).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 346, property: 0x20000, range: ["monsterZone"], reset: { flags: 1107169792 }, value: 1 },
    ]);

    restoredIgnitionOpen.session.state.phase = "battle";
    restoredIgnitionOpen.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredIgnitionOpen.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const firstAttack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === hexe.uid && action.targetUid === firstTarget.uid
    );
    expect(firstAttack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, firstAttack!);
    finishBattleUntilTrigger(restoredBattle);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === hexe.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === hexe.uid), restoredTrigger.session.state)).toBe(2600);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 1200 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === firstTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: hexe.uid,
    });
    const secondAttack = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === hexe.uid && action.targetUid === secondTarget.uid
    );
    expect(secondAttack, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(getLuaRestoreLegalActions(restoredTrigger, 0).some((action) => action.type === "declareAttack" && action.attackerUid === hexe.uid && action.directAttack === true)).toBe(false);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "battleDestroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: castle.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previousLocation: "deck", currentLocation: "spellTrapZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: castle.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: hexe.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: firstTarget.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: hexe.uid, eventReasonEffectId: undefined, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: firstTarget.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: hexe.uid, eventReasonEffectId: undefined, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: hexe.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, previousLocation: "deck", currentLocation: "monsterZone" },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCode(EFFECT_SUMMON_PROC)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.ffilter,0,LOCATION_FZONE,LOCATION_FZONE,1,nil)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.TRUE,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,e:GetHandler())");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)>0");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)");
  expect(script).toContain("e1:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)");
  expect(script).toContain("e1:SetValue(1)");
  expect(script).toContain("e3:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("e3:SetCondition(aux.bdocon)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(400)");
}

function cards(): DuelCardData[] {
  return [
    { code: hexeCode, name: "Hexe Trude", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 8, attack: 2200, defense: 2000 },
    { code: castleCode, name: "Golden Castle of Stromberg", kind: "spell", typeFlags: typeSpell | typeField },
    { code: firstTargetCode, name: "Hexe Trude First Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: secondTargetCode, name: "Hexe Trude Second Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(30);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
