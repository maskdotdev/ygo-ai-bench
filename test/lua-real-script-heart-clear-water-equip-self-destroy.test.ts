import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentBattleStep } from "#duel/battle-window-state.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace, type UpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Heart of Clear Water equip self destroy", () => {
  it("restores battle indestructible equip protection and self-destroys when the equipped monster reaches 1300 ATK", () => {
    const heartCode = "64801562";
    const lowTargetCode = "601048";
    const highTargetCode = "601049";
    const battleTargetCode = "601050";
    const responderCode = "601051";
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === heartCode),
      { code: lowTargetCode, name: "Heart Low-ATK Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1200, defense: 1000 },
      { code: highTargetCode, name: "Heart High-ATK Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1300, defense: 1000 },
      { code: battleTargetCode, name: "Heart Battle Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
      { code: responderCode, name: "Heart Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };

    const low = setupHeartSession(workspace, reader, heartCode, lowTargetCode, battleTargetCode, responderCode, 311);
    expect(low.host.loadCardScript(Number(heartCode), source).ok).toBe(true);
    expect(low.host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(low.host.registerInitialEffects()).toBe(2);
    const restoredLowEquipWindow = restoreDuelWithLuaScripts(serializeDuel(low.session), source, reader);
    expectCleanRestore(restoredLowEquipWindow);
    expectRestoredLegalActions(restoredLowEquipWindow, 0);
    const lowEquip = getLuaRestoreLegalActions(restoredLowEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === low.heart.uid);
    expect(lowEquip, JSON.stringify(getLuaRestoreLegalActions(restoredLowEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredLowEquipWindow, lowEquip!);
    const restoredLowChain = restoreDuelWithLuaScripts(serializeDuel(restoredLowEquipWindow.session), source, reader);
    expectCleanRestore(restoredLowChain);
    expectRestoredLegalActions(restoredLowChain, 1);
    resolveRestoredChain(restoredLowChain);
    expect(restoredLowChain.session.state.cards.find((card) => card.uid === low.heart.uid)).toMatchObject({ location: "spellTrapZone", equippedToUid: low.target.uid, faceUp: true });
    expect(restoredLowChain.host.messages).not.toContain("heart responder resolved");

    const restoredLowState = restoreDuelWithLuaScripts(serializeDuel(restoredLowChain.session), source, reader);
    expectCleanRestore(restoredLowState);
    expectRestoredLegalActions(restoredLowState, restoredLowState.session.state.waitingFor ?? restoredLowState.session.state.turnPlayer);
    const battleIndestructible = restoredLowState.session.state.effects.find((effect) => effect.sourceUid === low.heart.uid && effect.code === 42);
    expect(battleIndestructible?.event).toBe("continuous");
    expect(battleIndestructible?.range).toEqual(["spellTrapZone"]);
    expect(battleIndestructible?.value).toBe(1);
    const selfDestroy = restoredLowState.session.state.effects.find((effect) => effect.sourceUid === low.heart.uid && effect.code === 141);
    expect(selfDestroy?.event).toBe("continuous");
    expect(selfDestroy?.range).toEqual(["spellTrapZone"]);

    restoredLowState.session.state.turnPlayer = 0;
    restoredLowState.session.state.phase = "battle";
    restoredLowState.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredLowState.session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === low.target.uid && action.targetUid === low.battleTarget.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    passRestoredBattleResponses(restoredBattle);
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(7400);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === low.target.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === low.battleTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1 });

    const high = setupHeartSession(workspace, reader, heartCode, highTargetCode, battleTargetCode, responderCode, 312);
    expect(high.host.loadCardScript(Number(heartCode), source).ok).toBe(true);
    expect(high.host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(high.host.registerInitialEffects()).toBe(2);
    const restoredHighEquipWindow = restoreDuelWithLuaScripts(serializeDuel(high.session), source, reader);
    expectCleanRestore(restoredHighEquipWindow);
    expectRestoredLegalActions(restoredHighEquipWindow, 0);
    const highEquip = getLuaRestoreLegalActions(restoredHighEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === high.heart.uid);
    expect(highEquip, JSON.stringify(getLuaRestoreLegalActions(restoredHighEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredHighEquipWindow, highEquip!);
    const restoredHighChain = restoreDuelWithLuaScripts(serializeDuel(restoredHighEquipWindow.session), source, reader);
    expectCleanRestore(restoredHighChain);
    expectRestoredLegalActions(restoredHighChain, 1);
    resolveRestoredChain(restoredHighChain);
    expect(restoredHighChain.session.state.cards.find((card) => card.uid === high.heart.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      previousEquippedToUid: high.target.uid,
    });
    expect(restoredHighChain.session.state.cards.find((card) => card.uid === high.target.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredHighChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === high.heart.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: high.heart.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: high.heart.uid,
        eventReasonEffectId: 5,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
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
  });
});

function setupHeartSession(
  workspace: UpstreamNodeWorkspace,
  reader: ReturnType<typeof createCardReader>,
  heartCode: string,
  targetCode: string,
  battleTargetCode: string,
  responderCode: string,
  seed: number,
): { session: DuelSession; host: ReturnType<typeof createLuaScriptHost>; heart: NonNullable<ReturnType<DuelSession["state"]["cards"]["find"]>>; target: NonNullable<ReturnType<DuelSession["state"]["cards"]["find"]>>; battleTarget: NonNullable<ReturnType<DuelSession["state"]["cards"]["find"]>> } {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [heartCode, targetCode] }, 1: { main: [battleTargetCode, responderCode] } });
  startDuel(session);
  const heart = session.state.cards.find((card) => card.code === heartCode);
  const target = session.state.cards.find((card) => card.code === targetCode);
  const battleTarget = session.state.cards.find((card) => card.code === battleTargetCode);
  const responder = session.state.cards.find((card) => card.code === responderCode);
  expect(heart).toBeDefined();
  expect(target).toBeDefined();
  expect(battleTarget).toBeDefined();
  expect(responder).toBeDefined();
  moveDuelCard(session.state, heart!.uid, "hand", 0);
  moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
  moveDuelCard(session.state, battleTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
  moveDuelCard(session.state, responder!.uid, "hand", 1);
  session.state.phase = "main1";
  session.state.waitingFor = 0;
  return { session, host: createLuaScriptHost(session, workspace), heart: heart!, target: target!, battleTarget: battleTarget! };
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("heart responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
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

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = currentBattleStep(restored.session.state) === "damage" || currentBattleStep(restored.session.state) === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
