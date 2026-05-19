import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const mojaCode = "94878265";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasMojaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mojaCode}.lua`));
const typeMonster = 0x1;
const raceBeast = 0x4000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasMojaScript)("Lua real script Moja battle-destroyed Graveyard return", () => {
  it("restores EVENT_BATTLE_DESTROYED targeting a Level 4 Beast in Graveyard and returns it to hand", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const graveBeastCode = "9487";
    const attackerCode = "9488";
    const script = workspace.readScript(`c${mojaCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYED)");
    expect(script).toContain("return e:GetHandler():IsLocation(LOCATION_GRAVE) and e:GetHandler():IsReason(REASON_BATTLE)");
    expect(script).toContain("return c:GetLevel()==4 and c:IsRace(RACE_BEAST) and c:IsAbleToHand()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,tc)");
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mojaCode),
      { code: graveBeastCode, name: "Moja Graveyard Beast", kind: "monster", typeFlags: typeMonster, race: raceBeast, level: 4, attack: 1600, defense: 1200 },
      { code: attackerCode, name: "Moja Battle Destroyer", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9487, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mojaCode, graveBeastCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const moja = session.state.cards.find((card) => card.code === mojaCode);
    const graveBeast = session.state.cards.find((card) => card.code === graveBeastCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    expect(moja).toBeDefined();
    expect(graveBeast).toBeDefined();
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, moja!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, graveBeast!.uid, "graveyard", 0);
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mojaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredInitial);
    expectRestoredLegalActions(restoredInitial, 1);
    expect(restoredInitial.session.state.effects.find((effect) => effect.sourceUid === moja!.uid)).toMatchObject({
      category: 0x8,
      code: 1140,
      event: "trigger",
      triggerEvent: "battleDestroyed",
      triggerSourceOnly: true,
    });

    const attack = getLuaRestoreLegalActions(restoredInitial, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === moja!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredInitial, attack!);
    passBattleResponses(restoredInitial.session);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(getLuaRestoreLegalActions(restoredTrigger, 1)).toEqual([]);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        player: 0,
        effectId: "lua-1-1140",
        sourceUid: moja!.uid,
        triggerBucket: "opponentOptional",
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: moja!.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker!.uid,
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
          sequence: 1,
        },
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === moja!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === moja!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === graveBeast!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "sentToHand")).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: graveBeast!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: moja!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "sentToHandConfirmed")).toEqual([
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: graveBeast!.uid,
        eventPlayer: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: moja!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventUids: [graveBeast!.uid],
        eventValue: 1,
      },
    ]);
  });
});

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

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
