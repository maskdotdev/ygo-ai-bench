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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Zone Eater delayed battle destroy", () => {
  it("restores battled target markers and destroys the marked monster on the fifth End Phase", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const zoneEaterCode = "86100785";
    const targetCode = "861007850";
    const script = workspace.readScript(`c${zoneEaterCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_BATTLED)");
    expect(script).toContain("c==Duel.GetAttacker() and bc and bc:IsRelateToBattle() and bc:IsFaceup()");
    expect(script).toContain("bc:RegisterEffect(e1)");
    expect(script).toContain("e:GetLabelObject():AddCard(bc)");
    expect(script).toContain("e3:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("Duel.HintSelection(sg)");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === zoneEaterCode),
      { code: targetCode, name: "Zone Eater Delayed Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 86100785, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [zoneEaterCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const zoneEater = requireCard(session, zoneEaterCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, zoneEater.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(zoneEaterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === zoneEater.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilPendingTrigger(session, "afterDamageCalculation");
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-5-1",
        player: 0,
        sourceUid: zoneEater.uid,
        effectId: "lua-1-1138",
        eventName: "afterDamageCalculation",
        triggerBucket: "turnMandatory",
        eventTriggerTiming: "when",
        eventReason: 0,
        eventReasonPlayer: 0,
        eventCode: 1138,
        eventUids: [zoneEater.uid, target.uid],
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCardUid: zoneEater.uid,
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const trigger = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "activateTrigger" && action.uid === zoneEater.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredAndAssert(restoredBattle, trigger!);
    passRestoredBattleResponses(restoredBattle);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredBattle.session.state.effects.some((effect) => effect.sourceUid === target.uid && effect.code === Number(zoneEaterCode))).toBe(true);
    expect(restoredBattle.session.state.effects.some((effect) => effect.triggerEvent === "phaseEnd" && effect.sourceUid === zoneEater.uid)).toBe(true);

    let restored = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    for (let i = 1; i <= 5; i += 1) {
      expectCleanRestore(restored);
      restored.session.state.phase = "main2";
      restored.session.state.turnPlayer = i % 2 === 1 ? 0 : 1;
      restored.session.state.waitingFor = restored.session.state.turnPlayer;
      expectRestoredLegalActions(restored, restored.session.state.turnPlayer);
      const endPhase = getLuaRestoreLegalActions(restored, restored.session.state.turnPlayer).find((action) => action.type === "changePhase" && action.phase === "end");
      expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restored, restored.session.state.turnPlayer), null, 2)).toBeDefined();
      applyRestoredAndAssert(restored, endPhase!);
      const currentTarget = restored.session.state.cards.find((card) => card.uid === target.uid);
      if (i < 5) expect(currentTarget).toMatchObject({ location: "monsterZone", controller: 1 });
      else {
        expect(currentTarget).toMatchObject({
          location: "graveyard",
          controller: 1,
          reason: duelReason.effect | duelReason.destroy,
          reasonPlayer: 0,
          reasonCardUid: zoneEater.uid,
        });
        expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === target.uid)).toEqual([
          {
            eventName: "destroyed",
            eventCode: 1029,
            eventCardUid: target.uid,
            eventReason: duelReason.effect | duelReason.destroy,
            eventReasonPlayer: 0,
            eventReasonCardUid: zoneEater.uid,
            eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
            eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
          },
        ]);
      }
      if (i < 5) {
        const endTurn = getLuaRestoreLegalActions(restored, restored.session.state.turnPlayer).find((action) => action.type === "endTurn");
        expect(endTurn, JSON.stringify(getLuaRestoreLegalActions(restored, restored.session.state.turnPlayer), null, 2)).toBeDefined();
        applyRestoredAndAssert(restored, endTurn!);
      }
      restored = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    }

    expectCleanRestore(restored);
    expect(restored.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: zoneEater.uid,
    });
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passUntilPendingTrigger(session: DuelSession, eventName: string): void {
  let guard = 0;
  while (!session.state.pendingTriggers.some((trigger) => trigger.eventName === eventName)) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
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

function applyRestoredAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAndAssert(restored, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
