import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter } from "#duel/counters.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const zushinCode = "67547370";
const releaseCode = "67547371";
const targetCode = "67547372";
const typeMonster = 0x1;
const typeNormal = 0x10;
const counterZushin = 0x1039;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Zushin counter release battle stat", () => {
  it("restores its ten-counter release Special Summon procedure and pre-damage ATK/DEF finalization", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${zushinCode}.lua`);
    expect(script).toContain("Duel.CheckReleaseGroup(c:GetControler(),s.spfilter,1,false,1,true,c,c:GetControler(),nil,false,nil)");
    expect(script).toContain("Duel.SelectReleaseGroup(tp,s.spfilter,1,1,false,true,true,c,nil,nil,false,nil)");
    expect(script).toContain("Duel.Release(g,REASON_COST)");
    expect(script).toContain("tc:AddCounter(0x1039,1)");
    expect(script).toContain("e5:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === zushinCode),
      { code: releaseCode, name: "Zushin Release Normal", kind: "monster", typeFlags: typeMonster | typeNormal, level: 1, attack: 300, defense: 200 },
      { code: targetCode, name: "Zushin Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 67547370, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [zushinCode, releaseCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const zushin = requireCard(session, zushinCode);
    const release = requireCard(session, releaseCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, zushin.uid, "hand", 0);
    moveFaceUpAttack(session, release.uid, 0, 0);
    moveFaceUpAttack(session, target.uid, 1, 0);
    expect(addDuelCardCounter(release, counterZushin, 10)).toBe(true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(zushinCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const procedure = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === zushin.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestored(restoredOpen, procedure!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === release.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: zushin.uid,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === zushin.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["released", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: release.uid,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: zushin.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: zushin.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === zushin.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestored(restoredBattle, attack!);
    passRestoredUntilBattleWindow(restoredBattle, "beforeDamageCalculation");
    const trigger = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "activateTrigger" && action.uid === zushin.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestored(restoredBattle, trigger!);
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === zushin.uid), restoredBattle.session.state)).toBe(2500);
    expect(currentDefense(restoredBattle.session.state.cards.find((card) => card.uid === zushin.uid), restoredBattle.session.state)).toBe(2500);

    const restoredDamage = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredDamage);
    expect(currentAttack(restoredDamage.session.state.cards.find((card) => card.uid === zushin.uid), restoredDamage.session.state)).toBe(2500);
    expect(currentDefense(restoredDamage.session.state.cards.find((card) => card.uid === zushin.uid), restoredDamage.session.state)).toBe(2500);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, uid: string, player: PlayerId, sequence: number): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
  card.sequence = sequence;
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredUntilBattleWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
  let guard = 0;
  while (restored.session.state.battleWindow?.kind !== kind) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestored(restored, pass!);
  }
}
