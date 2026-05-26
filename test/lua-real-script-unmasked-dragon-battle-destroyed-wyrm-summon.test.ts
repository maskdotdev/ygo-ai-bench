import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelLocation, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const unmaskedDragonCode = "24218047";
const hasUnmaskedDragonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${unmaskedDragonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const raceWyrm = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasUnmaskedDragonScript)("Lua real script Unmasked Dragon battle destroyed Wyrm summon", () => {
  it("restores Unmasked Dragon's battle-destroyed Wyrm DEF filter and face-up Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wyrmTargetCode = "24218048";
    const highDefenseWyrmCode = "24218049";
    const dragonDecoyCode = "24218050";
    const attackerCode = "24218051";
    const script = workspace.readScript(`c${unmaskedDragonCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYED)");
    expect(script).toContain("return e:GetHandler():IsLocation(LOCATION_GRAVE) and e:GetHandler():IsReason(REASON_BATTLE)");
    expect(script).toContain("return c:IsDefenseBelow(1500) and c:IsRace(RACE_WYRM)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: unmaskedDragonCode, name: "Unmasked Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, race: raceDragon, attack: 1400, defense: 1100 },
      { code: wyrmTargetCode, name: "Unmasked Dragon Wyrm Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, race: raceWyrm, attack: 1400, defense: 1200 },
      { code: highDefenseWyrmCode, name: "Unmasked Dragon High DEF Wyrm", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, race: raceWyrm, attack: 1200, defense: 1600 },
      { code: dragonDecoyCode, name: "Unmasked Dragon Race Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, race: raceDragon, attack: 1200, defense: 1000 },
      { code: attackerCode, name: "Unmasked Dragon Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, race: raceDragon, attack: 1800, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 24218047, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [unmaskedDragonCode, wyrmTargetCode, highDefenseWyrmCode, dragonDecoyCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const unmaskedDragon = requireCard(session, unmaskedDragonCode);
    const wyrmTarget = requireCard(session, wyrmTargetCode);
    const highDefenseWyrm = requireCard(session, highDefenseWyrmCode);
    const dragonDecoy = requireCard(session, dragonDecoyCode);
    const attacker = requireCard(session, attackerCode);
    const movedUnmasked = moveDuelCard(session.state, unmaskedDragon.uid, "monsterZone", 0);
    movedUnmasked.position = "faceUpAttack";
    movedUnmasked.faceUp = true;
    const movedAttacker = moveDuelCard(session.state, attacker.uid, "monsterZone", 1);
    movedAttacker.position = "faceUpAttack";
    movedAttacker.faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(unmaskedDragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredInitial);
    expectRestoredLegalActions(restoredInitial, 1);
    expect(restoredInitial.session.state.effects.find((effect) => effect.sourceUid === unmaskedDragon.uid)).toMatchObject({
      category: 0x200,
      code: 1140,
      event: "trigger",
      registryKey: "lua:24218047:lua-1-1140",
      triggerEvent: "battleDestroyed",
      triggerSourceOnly: true,
    });

    const attack = getLuaRestoreLegalActions(restoredInitial, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === unmaskedDragon.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredInitial, attack!);
    passBattleResponses(restoredInitial.session);
    expect(restoredInitial.session.state.cards.find((card) => card.uid === unmaskedDragon.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonCardUid: attacker.uid,
    });
    expect(restoredInitial.session.state.pendingTriggers).toEqual([
      {
        player: 0,
        id: "trigger-6-1",
        effectId: "lua-1-1140",
        sourceUid: unmaskedDragon.uid,
        triggerBucket: "opponentOptional",
        eventName: "battleDestroyed",
        eventPlayer: 0,
        eventCode: 1140,
        eventCardUid: unmaskedDragon.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventTriggerTiming: "when",
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);

    const targetPreviousState = cardEventState(wyrmTarget);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(getLuaRestoreLegalActions(restoredTrigger, 1)).toEqual([]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === unmaskedDragon.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);

    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === unmaskedDragon.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === wyrmTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === highDefenseWyrm.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === dragonDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["battleDestroyed", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: unmaskedDragon.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: wyrmTarget.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: unmaskedDragon.uid,
        eventReasonEffectId: 1,
        eventUids: [wyrmTarget.uid],
        eventPreviousState: targetPreviousState,
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function cardEventState(card: { controller: PlayerId; faceUp?: boolean; location: DuelLocation; position?: string; sequence: number }) {
  return {
    controller: card.controller,
    faceUp: card.faceUp,
    location: card.location,
    position: card.position,
    sequence: card.sequence,
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
