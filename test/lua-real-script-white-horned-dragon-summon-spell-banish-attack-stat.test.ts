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
const dragonCode = "73891874";
const tributeCode = "738918740";
const firstSpellCode = "738918741";
const secondSpellCode = "738918742";
const thirdSpellCode = "738918743";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDragonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dragonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDragonScript)("Lua real script White-Horned Dragon summon spell banish attack stat", () => {
  it("restores tribute summon trigger into opponent Spell banish and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dragonCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredSummon = createRestoredWhiteHornedSummonWindow({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const dragon = requireCard(restoredSummon.session, dragonCode);
    const tribute = requireCard(restoredSummon.session, tributeCode);
    const spells = [firstSpellCode, secondSpellCode, thirdSpellCode].map((code) => requireCard(restoredSummon.session, code));

    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "tributeSummon" && action.uid === dragon.uid && action.tributeUids.includes(tribute.uid)
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === dragon.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    if (!trigger || trigger.type !== "activateTrigger") throw new Error("Expected White-Horned Dragon summon trigger");
    const effectNumericId = Number(trigger.effectId.split("-")[1]);
    applyRestoredActionAndAssert(restoredTrigger, trigger);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === tribute.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.summon,
      reasonPlayer: 0,
    });
    for (const spell of spells) {
      expect(restoredTrigger.session.state.cards.find((card) => card.uid === spell.uid)).toMatchObject({
        location: "banished",
        controller: 1,
        faceUp: true,
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: dragon.uid,
        reasonEffectId: effectNumericId,
      });
    }
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === dragon.uid), restoredTrigger.session.state)).toBe(3100);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === dragon.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33492992 }, sourceUid: dragon.uid, value: 900 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "becameTarget", "banished"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: dragon.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: undefined },
      { eventCardUid: spells[0]!.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: effectNumericId },
      { eventCardUid: spells[1]!.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: effectNumericId },
      { eventCardUid: spells[2]!.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: effectNumericId },
      { eventCardUid: spells[0]!.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: dragon.uid, eventReasonEffectId: effectNumericId, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: undefined },
      { eventCardUid: spells[1]!.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: dragon.uid, eventReasonEffectId: effectNumericId, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: undefined },
      { eventCardUid: spells[2]!.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: dragon.uid, eventReasonEffectId: effectNumericId, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: undefined },
      { eventCardUid: spells[0]!.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: dragon.uid, eventReasonEffectId: effectNumericId, eventReasonPlayer: 0, eventUids: spells.map((spell) => spell.uid), relatedEffectId: undefined },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredWhiteHornedSummonWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 73891874, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [dragonCode, tributeCode] }, 1: { main: [firstSpellCode, secondSpellCode, thirdSpellCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, dragonCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, tributeCode), 0, 0);
  for (const [index, code] of [firstSpellCode, secondSpellCode, thirdSpellCode].entries()) {
    moveFaceUpGrave(session, requireCard(session, code), 1, index);
  }
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dragonCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("White-Horned Dragon");
  expect(script).toContain("CATEGORY_ATKCHANGE+CATEGORY_REMOVE");
  expect(script).toContain("EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F");
  expect(script).toContain("EFFECT_FLAG_CARD_TARGET");
  expect(script).toContain("EVENT_SUMMON_SUCCESS");
  expect(script).toContain("EVENT_SPSUMMON_SUCCESS");
  expect(script).toContain("return c:IsSpell() and c:IsAbleToRemove()");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_GRAVE,1,5,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,#g,0,0)");
  expect(script).toContain("Duel.GetTargetCards(e)");
  expect(script).toContain("local ct=Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("EFFECT_UPDATE_ATTACK");
  expect(script).toContain("RESET_EVENT|RESETS_STANDARD_DISABLE");
  expect(script).toContain("e1:SetValue(ct*300)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const dragon = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === dragonCode);
  expect(dragon).toBeDefined();
  return [
    { ...dragon!, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark },
    { code: tributeCode, name: "White-Horned Dragon Tribute", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: firstSpellCode, name: "White-Horned First Spell", kind: "spell", typeFlags: typeSpell },
    { code: secondSpellCode, name: "White-Horned Second Spell", kind: "spell", typeFlags: typeSpell },
    { code: thirdSpellCode, name: "White-Horned Third Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpGrave(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "graveyard", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
