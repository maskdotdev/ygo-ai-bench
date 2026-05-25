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
const bigInflateDragonCode = "91337277";
const hasBigInflateDragonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bigInflateDragonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const attributeWind = 0x8;
const effectSetAttackFinal = 102;
const resetStandardDisablePhaseEnd = 1107235328;

describe.skipIf(!hasUpstreamScripts || !hasBigInflateDragonScript)("Lua real script Big Inflate Dragon summon decktop cost final ATK", () => {
  it("restores summon trigger cost banishing the top 50 cards face-down into 10000 final ATK", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${bigInflateDragonCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("Duel.GetDecktopGroup(tp,50)");
    expect(script).toContain("g:FilterCount(Card.IsAbleToRemoveAsCost,nil,POS_FACEDOWN)==50");
    expect(script).toContain("Duel.DisableShuffleCheck()");
    expect(script).toContain("Duel.Remove(g,POS_FACEDOWN,REASON_COST)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(10000)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");

    const tributeCodes = [`${bigInflateDragonCode}T0`, `${bigInflateDragonCode}T1`];
    const topCodes = Array.from({ length: 50 }, (_, index) => `${bigInflateDragonCode}${String(index).padStart(2, "0")}`);
    const reader = createCardReader(cards(topCodes));
    const session = createDuel({ seed: 91337277, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bigInflateDragonCode, ...tributeCodes, ...topCodes] }, 1: { main: [] } });
    startDuel(session);

    const bigInflateDragon = requireCard(session, bigInflateDragonCode);
    const tributes = tributeCodes.map((code, index) => moveFaceUpAttack(session, requireCard(session, code), 0, index));
    moveDuelCard(session.state, bigInflateDragon.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bigInflateDragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find(
      (action) => action.type === "tributeSummon" && action.uid === bigInflateDragon.uid && tributes.every((tribute) => action.tributeUids.includes(tribute.uid)),
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);

    expect(restoredSummon.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        effectId: "lua-1-1100",
        eventCardUid: bigInflateDragon.uid,
        eventCode: 1100,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "normalSummoned",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: bigInflateDragon.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === bigInflateDragon.uid && action.effectId === "lua-1-1100",
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    const banishedTopCards = topCodes.map((code) => requireCard(restoredTrigger.session, code));
    expect(banishedTopCards.map((card) => ({
      code: card.code,
      controller: card.controller,
      faceUp: card.faceUp,
      location: card.location,
      position: card.position,
      reason: card.reason,
      reasonCardUid: card.reasonCardUid,
      reasonEffectId: card.reasonEffectId,
      reasonPlayer: card.reasonPlayer,
    }))).toEqual(topCodes.map((code) => ({
      code,
      controller: 0,
      faceUp: false,
      location: "banished",
      position: "faceDownDefense",
      reason: duelReason.cost,
      reasonCardUid: bigInflateDragon.uid,
      reasonEffectId: 1,
      reasonPlayer: 0,
    })));
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === bigInflateDragon.uid), restoredTrigger.session.state)).toBe(10000);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === bigInflateDragon.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: resetStandardDisablePhaseEnd }, sourceUid: bigInflateDragon.uid, value: 10000 },
    ]);
    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === bigInflateDragon.uid), restoredStat.session.state)).toBe(10000);
  });
});

function cards(topCodes: string[]): DuelCardData[] {
  return [
    { code: bigInflateDragonCode, name: "Big Inflate Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeWind, level: 8, attack: 2500, defense: 1500 },
    { code: `${bigInflateDragonCode}T0`, name: "Big Inflate Dragon Tribute A", kind: "monster", typeFlags: typeMonster, race: raceDragon, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    { code: `${bigInflateDragonCode}T1`, name: "Big Inflate Dragon Tribute B", kind: "monster", typeFlags: typeMonster, race: raceDragon, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    ...topCodes.map((code, index) => ({
      code,
      name: `Big Inflate Dragon Cost Card ${index + 1}`,
      kind: "monster" as const,
      typeFlags: typeMonster,
      race: raceDragon,
      attribute: attributeWind,
      level: 4,
      attack: 1000,
      defense: 1000,
    })),
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
