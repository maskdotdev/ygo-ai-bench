import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const bettanCode = "84079032";
const summonTargetCode = "840790320";
const changeTargetCode = "840790321";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBettanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bettanCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasBettanScript)("Lua real script Bettan Bat summon coin position", () => {
  it("restores opponent summon TossCoin and position-change SelectPosition triggers", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${bettanCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 84079032, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bettanCode] }, 1: { main: [summonTargetCode, changeTargetCode] } });
    startDuel(session);

    const bettan = requireCard(session, bettanCode);
    const summonTarget = requireCard(session, summonTargetCode);
    const changeTarget = requireCard(session, changeTargetCode);
    moveMonster(session, bettan, 0, 0, "faceUpAttack", true);
    moveMonster(session, summonTarget, 1, 0, "faceUpDefense", true);
    summonTarget.summonPlayer = 1;
    moveMonster(session, changeTarget, 1, 1, "faceDownDefense", false);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bettanCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const raisedSummon = host.loadScript(
      `
      local tc=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${summonTargetCode}),0,0,LOCATION_MZONE,1,1,nil):GetFirst()
      Duel.RaiseEvent(tc,EVENT_SUMMON_SUCCESS,nil,REASON_SUMMON,0,1,0)
      `,
      "bettan-bat-opponent-summon.lua",
    );
    expect(raisedSummon.ok, raisedSummon.error).toBe(true);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    expect(restoredSummon.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-1-1100",
        sourceUid: bettan.uid,
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: summonTarget.uid,
        eventPlayer: 1,
        eventValue: 0,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        eventUids: [summonTarget.uid],
        eventTriggerTiming: "if",
        triggerBucket: "opponentOptional",
      },
    ]);
    const summonTrigger = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "activateTrigger" && action.uid === bettan.uid);
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summonTrigger!);
    passRestoredChain(restoredSummon);

    const tossed = restoredSummon.session.state.lastCoinResults[0];
    expect([0, 1]).toContain(tossed);
    expect(restoredSummon.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      position: tossed === 1 ? "faceUpAttack" : "faceDownDefense",
      faceUp: tossed === 1,
      reasonCardUid: bettan.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["normalSummoned", "coinTossed", "positionChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: summonTarget.uid,
        eventPlayer: 1,
        eventValue: 0,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        eventUids: [summonTarget.uid],
      },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: bettan.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: summonTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: bettan.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        eventCurrentState: {
          controller: 1,
          faceUp: tossed === 1,
          location: "monsterZone",
          position: tossed === 1 ? "faceUpAttack" : "faceDownDefense",
          sequence: 0,
        },
      },
    ]);

    const raisedPosition = restoredSummon.host.loadScript(
      `
      local tc=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${changeTargetCode}),0,0,LOCATION_MZONE,1,1,nil):GetFirst()
      Duel.ChangePosition(tc,POS_FACEUP_ATTACK)
      `,
      "bettan-bat-position-change.lua",
    );
    expect(raisedPosition.ok, raisedPosition.error).toBe(true);

    const restoredPosition = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredPosition);
    expectRestoredLegalActions(restoredPosition, 0);
    const positionTrigger = getLuaRestoreLegalActions(restoredPosition, 0).find((action) => action.type === "activateTrigger" && action.uid === bettan.uid);
    expect(positionTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredPosition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPosition, positionTrigger!);
    passRestoredChain(restoredPosition);

    expect(restoredPosition.session.state.cards.find((card) => card.uid === changeTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      position: "faceDownDefense",
      faceUp: false,
      reasonCardUid: bettan.uid,
      reasonEffectId: 3,
    });
    expect(restoredPosition.session.state.eventHistory.filter((event) => event.eventName === "positionChanged" && event.eventCardUid === changeTarget.uid)).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: changeTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: changeTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: bettan.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 1 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Bettan Bat");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN+CATEGORY_POSITION+CATEGORY_SET)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Card.IsSummonPlayer,1,nil,1-tp");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_POSITION,tg,1,tp,0)");
  expect(script).toContain("local coin=Duel.TossCoin(tp,1)");
  expect(script).toContain("Duel.ChangePosition(tc,pos)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY+EFFECT_FLAG_DAMAGE_STEP,EFFECT_FLAG2_CHECK_SIMULTANEOUS)");
  expect(script).toContain("e3:SetCode(EVENT_CHANGE_POS)");
  expect(script).toContain("Duel.SelectPosition(tp,tc,opt)");
}

function cards(): DuelCardData[] {
  return [
    { code: bettanCode, name: "Bettan Bat", kind: "monster", typeFlags: typeMonster | typeEffect, level: 1, attack: 0, defense: 0 },
    { code: summonTargetCode, name: "Bettan Summon Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1200 },
    { code: changeTargetCode, name: "Bettan Position Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number, position: DuelCardInstance["position"], faceUp: boolean): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.position = position;
  moved.faceUp = faceUp;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
