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
const purplePoisonCode = "48461764";
const attackerCode = "484617640";
const defenderCode = "484617641";
const destroyTargetCode = "484617642";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPurplePoisonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${purplePoisonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasPurplePoisonScript)("Lua real script Purple Poison Magician battle-confirm destroy", () => {
  it("restores PZONE battle-confirm ATK boost into self-destroyed delayed face-up destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${purplePoisonCode}.lua`);
    expectScriptShape(script);

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === purplePoisonCode),
      { code: attackerCode, name: "Purple Poison DARK Spellcaster Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
      { code: defenderCode, name: "Purple Poison Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1900, defense: 1000 },
      { code: destroyTargetCode, name: "Purple Poison Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 48461764, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [purplePoisonCode, attackerCode] }, 1: { main: [defenderCode, destroyTargetCode] } });
    startDuel(session);

    const purplePoison = requireCard(session, purplePoisonCode);
    const attacker = requireCard(session, attackerCode);
    const defender = requireCard(session, defenderCode);
    const destroyTarget = requireCard(session, destroyTargetCode);
    movePzone(session, purplePoison, 0, 0);
    moveFaceUpAttack(session, attacker, 0);
    moveFaceUpAttack(session, defender, 1);
    moveFaceUpAttack(session, destroyTarget, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(purplePoisonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passUntilPendingTrigger(restoredBattle, "battleConfirmed");
    expect(restoredBattle.session.state.battleWindow?.kind).toBe("startDamageStep");
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventCardUid: trigger.eventCardUid,
      eventUids: trigger.eventUids,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1133", eventName: "battleConfirmed", eventCode: 1133, eventCardUid: attacker.uid, eventUids: [attacker.uid, defender.uid], player: 0, sourceUid: purplePoison.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredConfirm = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredConfirm);
    expectRestoredLegalActions(restoredConfirm, 0);
    const confirmTrigger = getLuaRestoreLegalActions(restoredConfirm, 0).find((action) => action.type === "activateTrigger" && action.uid === purplePoison.uid);
    expect(confirmTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredConfirm, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredConfirm, confirmTrigger!);
    resolveRestoredChain(restoredConfirm);

    expect(currentAttack(restoredConfirm.session.state.cards.find((card) => card.uid === attacker.uid), restoredConfirm.session.state)).toBe(2700);
    expect(restoredConfirm.session.state.cards.find((card) => card.uid === purplePoison.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: purplePoison.uid,
      reasonEffectId: 3,
    });
    expect(restoredConfirm.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, reset: { flags: 1073741856 }, value: 1200 }]);

    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredConfirm.session), workspace, reader);
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    expect(restoredDestroyed.session.state.pendingTriggers).toMatchObject([
      {
        effectId: "lua-4-1029",
        sourceUid: purplePoison.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: purplePoison.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: purplePoison.uid,
        eventReasonEffectId: 3,
      },
    ]);
    const destroyedTrigger = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) => action.type === "activateTrigger" && action.uid === purplePoison.uid);
    expect(destroyedTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, destroyedTrigger!);
    expect(restoredDestroyed.session.state.chain).toEqual([]);
    const secondDestroyed = [attacker.uid, defender.uid, destroyTarget.uid]
      .map((uid) => restoredDestroyed.session.state.cards.find((card) => card.uid === uid))
      .find((card) => card?.location === "graveyard" && card.reasonEffectId === 4);
    expect(secondDestroyed).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: purplePoison.uid,
      reasonEffectId: 4,
    });
    expect(restoredDestroyed.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredDestroyed.session.state.eventHistory.filter((event) => ["battleConfirmed", "breakEffect", "destroyed", "becameTarget"].includes(event.eventName)).map((event) => ({
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
      { eventName: "battleConfirmed", eventCode: 1133, eventCardUid: attacker.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: purplePoison.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: undefined, currentLocation: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: purplePoison.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: purplePoison.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: "spellTrapZone", currentLocation: "extraDeck" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: secondDestroyed?.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: secondDestroyed?.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: purplePoison.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DESTROY)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_CONFIRM)");
  expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
  expect(script).toContain("a:IsAttribute(ATTRIBUTE_DARK) and a:IsRace(RACE_SPELLCASTER)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_DAMAGE)");
  expect(script).toContain("e1:SetValue(1200)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("return r&REASON_EFFECT+REASON_BATTLE~=0");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function movePzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function passUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, eventName: string): void {
  let guard = 0;
  while (!restored.session.state.pendingTriggers.some((trigger) => trigger.eventName === eventName)) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
