import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const falconCode = "81927732";
const materialCode = "819277320";
const raidraptorXyzCode = "819277321";
const battleTargetCode = "819277322";
const destroyTargetCode = "819277323";
const setRaidraptor = 0xba;
const typeMonster = 0x1;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Raidraptor Revolution Falcon battle and burn", () => {
  it("restores detach attack-all, battle-start final ATK/DEF, and target destroy half-ATK damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${falconCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_ATTACK_ALL)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_START)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,g:GetFirst():GetAttack()/2)");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
    expect(script).toContain("Duel.Damage(1-tp,dam,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === falconCode),
      { code: materialCode, name: "Revolution Falcon Material", kind: "monster", typeFlags: typeMonster, level: 6, attack: 1000, defense: 1000 },
      { code: raidraptorXyzCode, name: "Revolution Falcon Raidraptor Xyz Material", kind: "monster", typeFlags: typeMonster | typeXyz, setcodes: [setRaidraptor], level: 4, attack: 1200, defense: 1000 },
      { code: battleTargetCode, name: "Revolution Falcon Special Summoned Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2200, defense: 1800 },
      { code: destroyTargetCode, name: "Revolution Falcon Destroy Burn Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 81927732, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, raidraptorXyzCode], extra: [falconCode] }, 1: { main: [battleTargetCode, destroyTargetCode] } });
    startDuel(session);

    const falcon = requireCard(session, falconCode);
    const material = requireCard(session, materialCode);
    const rrXyz = requireCard(session, raidraptorXyzCode);
    const battleTarget = requireCard(session, battleTargetCode);
    const destroyTarget = requireCard(session, destroyTargetCode);
    moveFaceUpAttack(session, falcon.uid, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0);
    moveDuelCard(session.state, rrXyz.uid, "overlay", 0);
    falcon.overlayUids.push(material.uid, rrXyz.uid);
    moveDuelCard(session.state, battleTarget.uid, "hand", 1);
    moveFaceUpAttack(session, destroyTarget.uid, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(falconCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).not.toContain("unsupported");

    const restoredMain = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredMain);
    expectRestoredLegalActions(restoredMain, 0);
    const attackAll = getLuaRestoreLegalActions(restoredMain, 0).find((action) => action.type === "activateEffect" && action.uid === falcon.uid && action.effectId === "lua-2");
    expect(attackAll, JSON.stringify(getLuaRestoreLegalActions(restoredMain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredMain, attackAll!);
    expect(restoredMain.session.state.cards.find((card) => card.uid === falcon.uid)?.overlayUids).toEqual([rrXyz.uid]);
    expect(restoredMain.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "graveyard", reason: duelReason.cost });
    expect(restoredMain.session.state.effects.filter((effect) => effect.sourceUid === falcon.uid && effect.code === 193).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 193, event: "continuous", reset: { flags: 1107169792 }, value: 1 },
    ]);

    restoredMain.session.state.waitingFor = 0;
    const restoredDestroy = restoreDuelWithLuaScripts(serializeDuel(restoredMain.session), workspace, reader);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 0);
    const destroy = getLuaRestoreLegalActions(restoredDestroy, 0).find((action) => action.type === "activateEffect" && action.uid === falcon.uid && action.effectId === "lua-4");
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 0), null, 2)).toBeDefined();
    expect(restoredDestroy.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    applyRestoredActionAndAssert(restoredDestroy, destroy!);
    expect(restoredDestroy.session.state.cards.find((card) => card.uid === destroyTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: falcon.uid,
    });
    expect(restoredDestroy.session.state.players[1].lifePoints).toBe(7200);
    expect(restoredDestroy.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: falcon.uid,
        eventReasonEffectId: 4,
      },
    ]);

    specialSummonDuelCard(restoredDestroy.session.state, battleTarget.uid, 1);
    restoredDestroy.session.state.phase = "battle";
    restoredDestroy.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredDestroy.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === falcon.uid && action.targetUid === battleTarget.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passAttackResponsesUntilTrigger(restoredBattle);
    expect(restoredBattle.session.state.battleWindow?.kind).toBe("startDamageStep");

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const battleStart = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === falcon.uid);
    expect(battleStart, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, battleStart!);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === battleTarget.uid), restoredTrigger.session.state)).toBe(0);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === battleTarget.uid), restoredTrigger.session.state)).toBe(0);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === battleTarget.uid).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
    }))).toEqual([
      { code: 102, reset: { flags: 33427456 } },
      { code: 106, reset: { flags: 33427456 } },
    ]);

  });
});

function moveFaceUpAttack(session: DuelSession, uid: string, controller: PlayerId): DuelCardInstance {
  const card = moveDuelCard(session.state, uid, "monsterZone", controller);
  card.faceUp = true;
  card.position = "faceUpAttack";
  return card;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passAttackResponsesUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
