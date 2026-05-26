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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const shootingcodeCode = "33897356";
const linkedCyberseCode = "338973560";
const targetCode = "338973561";
const drawCode = "338973562";
const hasShootingcodeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${shootingcodeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasShootingcodeScript)("Lua real script Shootingcode Talker battle extra draw", () => {
  it("restores linked Battle Start extra attack, damage-calculation ATK loss, battle-destroying flag, and Battle Phase draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${shootingcodeCode}.lua`);
    expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_CYBERSE),2)");
    expect(script).toContain("e1:SetCode(EVENT_PHASE|PHASE_BATTLE_START)");
    expect(script).toContain("e:GetHandler():GetLinkedGroupCount()>0");
    expect(script).toContain("e1:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("return Duel.IsPhase(PHASE_DAMAGE_CAL) and Duel.GetFieldGroupCount(e:GetHandlerPlayer(),0,LOCATION_MZONE)==1");
    expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_BATTLE)");
    expect(script).toContain("e3:SetCode(EVENT_BATTLE_DESTROYING)");
    expect(script).toContain("e3:SetCondition(aux.bdcon)");
    expect(script).toContain("c:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1,1)");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.SetTargetParam(ct)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");

    const cards: DuelCardData[] = [
      { code: shootingcodeCode, name: "Shootingcode Talker", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, level: 3, attack: 2300, defense: 0, linkMarkers: 0x28 },
      { code: linkedCyberseCode, name: "Linked Cyberse", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, level: 4, attack: 1000, defense: 1000 },
      { code: targetCode, name: "Shootingcode Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
      { code: drawCode, name: "Shootingcode Draw", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 33897356, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [linkedCyberseCode, drawCode], extra: [shootingcodeCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const shootingcode = requireCard(session, shootingcodeCode);
    const linkedCyberse = requireCard(session, linkedCyberseCode);
    const target = requireCard(session, targetCode);
    const draw = requireCard(session, drawCode);
    moveFaceUpAttack(session, shootingcode, 0, 1);
    moveFaceUpAttack(session, linkedCyberse, 0, 0);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(shootingcodeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredMain = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredMain);
    expectRestoredLegalActions(restoredMain, 0);
    const toBattle = getLuaRestoreLegalActions(restoredMain, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(toBattle, JSON.stringify(getLuaRestoreLegalActions(restoredMain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredMain, toBattle!);
    expect(restoredMain.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-4104",
        sourceUid: shootingcode.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "phaseBattle",
        eventCode: 4104,
        eventTriggerTiming: "when",
      },
    ]);

    const restoredBattleStart = restoreDuelWithLuaScripts(serializeDuel(restoredMain.session), workspace, reader);
    expectCleanRestore(restoredBattleStart);
    expectRestoredLegalActions(restoredBattleStart, 0);
    const battleStart = getLuaRestoreLegalActions(restoredBattleStart, 0).find((action) => action.type === "activateTrigger" && action.uid === shootingcode.uid);
    expect(battleStart, JSON.stringify(getLuaRestoreLegalActions(restoredBattleStart, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleStart, battleStart!);
    resolveRestoredChain(restoredBattleStart);
    expect(restoredBattleStart.session.state.effects.filter((effect) => effect.sourceUid === shootingcode.uid && [100, 346].includes(effect.code ?? 0)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 346, reset: { flags: 1107169408 }, value: 2 },
      { code: 100, reset: { flags: 1107169792 }, value: -400 },
    ]);

    const attack = getLuaRestoreLegalActions(restoredBattleStart, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === shootingcode.uid && action.targetUid === target.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattleStart, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleStart, attack!);
    passUntilDamageCalculation(restoredBattleStart);
    expect(restoredBattleStart.session.state.battleStep).toBe("damageCalculation");
    expect(currentAttack(restoredBattleStart.session.state.cards.find((card) => card.uid === shootingcode.uid), restoredBattleStart.session.state)).toBe(1900);
    finishBattle(restoredBattleStart);
    expect(restoredBattleStart.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: shootingcode.uid,
    });
    const restoredEndBattle = restoreDuelWithLuaScripts(serializeDuel(restoredBattleStart.session), workspace, reader);
    expectCleanRestore(restoredEndBattle);
    expectRestoredLegalActions(restoredEndBattle, 0);
    const main2 = getLuaRestoreLegalActions(restoredEndBattle, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2, JSON.stringify(getLuaRestoreLegalActions(restoredEndBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndBattle, main2!);
    expect(restoredEndBattle.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-10-1",
        effectId: "lua-3-4224",
        sourceUid: shootingcode.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "phaseBattle",
        eventCode: 4224,
        eventTriggerTiming: "when",
      },
    ]);

    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(restoredEndBattle.session), workspace, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 0);
    const drawTrigger = getLuaRestoreLegalActions(restoredDraw, 0).find((action) => action.type === "activateTrigger" && action.uid === shootingcode.uid);
    expect(drawTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDraw, drawTrigger!);
    resolveRestoredChain(restoredDraw);
    expect(restoredDraw.session.state.cards.find((card) => card.uid === draw.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredDraw.session.state.eventHistory.filter((event) => ["battleDestroyed", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: target.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: shootingcode.uid,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: draw.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: shootingcode.uid,
        eventReasonEffectId: 3,
        eventUids: [draw.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function passUntilBattleStarted(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passUntilDamageCalculation(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.battleStep !== "damageCalculation") {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
