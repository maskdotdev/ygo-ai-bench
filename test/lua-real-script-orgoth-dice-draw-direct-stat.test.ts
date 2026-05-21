import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const orgothCode = "15744417";
const defenderCode = "157444170";
const drawACode = "157444171";
const drawBCode = "157444172";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const raceWarrior = 0x1;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Orgoth dice draw direct stat", () => {
  it("restores triple dice into ATK/DEF gain, draw, protection, and direct attack permission", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const orgothData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === orgothCode);
    expect(orgothData).toBeDefined();
    const script = workspace.readScript(`c${orgothCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DICE+CATEGORY_ATKCHANGE+CATEGORY_DRAW)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DICE,nil,0,tp,3)");
    expect(script).toContain("for _,i in ipairs({Duel.TossDice(tp,3)}) do");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
    expect(script).toContain("Duel.Draw(tp,2,REASON_EFFECT)");
    expect(script).toContain("e3:SetCode(EFFECT_DIRECT_ATTACK)");

    const cards: DuelCardData[] = [
      orgothData!,
      { code: defenderCode, name: "Orgoth Defender Fixture", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1200 },
      { code: drawACode, name: "Orgoth Draw Fixture A", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
      { code: drawBCode, name: "Orgoth Draw Fixture B", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [orgothCode, drawACode, drawBCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const orgoth = requireCard(session, orgothCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, orgoth, 0);
    moveFaceUpAttack(session, defender, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(orgothCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const ignition = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === orgoth.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(ignition)).not.toContain("operationInfos");
    applyRestoredActionAndAssert(restoredActivation, ignition!);
    resolveRestoredChain(restoredActivation);

    expect(restoredActivation.session.state.lastDiceResults).toEqual([3, 3, 3]);
    expect(restoredActivation.session.state.randomCounter).toBe(3);
    expect(restoredActivation.session.state.eventHistory.filter((event) => ["diceTossed", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "diceTossed",
        eventCode: 1150,
        eventPlayer: 0,
        eventValue: 3,
        eventReason: duelReason.effect,
        eventReasonCardUid: orgoth.uid,
        eventReasonEffectId: 1,
        eventReasonPlayer: 0,
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: drawACodeUid(restoredActivation.session),
        eventPlayer: 0,
        eventValue: 2,
        eventReason: duelReason.effect,
        eventReasonCardUid: orgoth.uid,
        eventReasonEffectId: 1,
        eventReasonPlayer: 0,
        eventUids: [drawACodeUid(restoredActivation.session), drawBCodeUid(restoredActivation.session)],
        eventPreviousState: { location: "deck", controller: 0, sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { location: "hand", controller: 0, sequence: 0, position: "faceDown", faceUp: false },
      },
    ]);
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === orgoth.uid), restoredActivation.session.state)).toBe((orgothData!.attack ?? 0) + 900);
    expect(currentDefense(restoredActivation.session.state.cards.find((card) => card.uid === orgoth.uid), restoredActivation.session.state)).toBe((orgothData!.defense ?? 0) + 900);
    expect(restoredActivation.session.state.cards.filter((card) => card.controller === 0 && card.location === "hand").map((card) => card.code).sort()).toEqual([drawACode, drawBCode]);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.sourceUid === orgoth.uid && [41, 42, 74, 100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", property: undefined, value: 900 },
      { code: 104, event: "continuous", property: undefined, value: 900 },
      { code: 42, event: "continuous", property: 0x4000000, value: 1 },
      { code: 41, event: "continuous", property: 0x4000000, value: 1 },
      { code: 74, event: "continuous", property: 0x4000400, value: undefined },
    ]);

    restoredActivation.session.state.phase = "battle";
    restoredActivation.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const battleActions = getLuaRestoreLegalActions(restoredBattle, 0);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === orgoth.uid && action.targetUid === defender.uid)).toBe(true);
    const directAttack = battleActions.find((action) => action.type === "declareAttack" && action.attackerUid === orgoth.uid && action.directAttack);
    expect(directAttack, JSON.stringify(battleActions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, directAttack!);
    passBattle(restoredBattle);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(8000 - (orgothData!.attack ?? 0) - 900);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
    }))).toEqual([
      { eventName: "battleDamageDealt", eventCode: 1143, eventCardUid: orgoth.uid, eventPlayer: 1, eventValue: (orgothData!.attack ?? 0) + 900, eventReasonPlayer: 0, eventReasonCardUid: orgoth.uid },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function drawACodeUid(session: DuelSession): string {
  return requireCard(session, drawACode).uid;
}

function drawBCodeUid(session: DuelSession): string {
  return requireCard(session, drawBCode).uid;
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
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    if (restored.session.state.pendingTriggers.length > 0) break;
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
