import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { collectDuelTriggerEvent, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const blastCode = "89870349";
const opponentMonsterCode = "898703490";
const opponentSpellCode = "898703491";
const opponentFacedownDecoyCode = "898703492";
const ownSpellDecoyCode = "898703493";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBlastScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${blastCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceWarrior = 0x1;
const attributeWind = 0x8;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBlastScript)("Lua real script Masked HERO Blast summon final attack pay to-hand", () => {
  it("restores summon target final ATK halving and LP-cost Quick Effect Spell/Trap return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${blastCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const restoredSummon = createRestoredSummonTrigger({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);

    const blast = requireCard(restoredSummon.session, blastCode);
    const opponentMonster = requireCard(restoredSummon.session, opponentMonsterCode);
    expect(restoredSummon.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1102", eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: blast.uid, triggerBucket: "turnOptional" },
    ]);
    const summonStat = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === blast.uid && action.effectId === "lua-3-1102"
    );
    expect(summonStat, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summonStat!);
    resolveRestoredChain(restoredSummon);

    expect(currentAttack(restoredSummon.session.state.cards.find((card) => card.uid === opponentMonster.uid), restoredSummon.session.state)).toBe(1200);
    expect(restoredSummon.session.state.effects.filter((effect) =>
      effect.sourceUid === opponentMonster.uid && effect.code === effectSetAttackFinal
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 33427456 }, sourceUid: opponentMonster.uid, value: 1200 },
    ]);
    expect(restoredSummon.session.state.eventHistory.filter((event) =>
      ["specialSummoned", "becameTarget"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: blast.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: opponentMonster.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 3 },
    ]);
    expect(restoredSummon.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredQuick = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const opponentSpell = requireCard(restoredQuick.session, opponentSpellCode);
    const opponentFacedownDecoy = requireCard(restoredQuick.session, opponentFacedownDecoyCode);
    const ownSpellDecoy = requireCard(restoredQuick.session, ownSpellDecoyCode);
    const quickReturn = getLuaRestoreLegalActions(restoredQuick, 0).find((action) =>
      action.type === "activateEffect" && action.uid === blast.uid && action.effectId === "lua-4-1002"
    );
    expect(quickReturn, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, quickReturn!);
    resolveRestoredChain(restoredQuick);

    expect(restoredQuick.session.state.players[0].lifePoints).toBe(7500);
    expect(restoredQuick.session.state.cards.find((card) => card.uid === opponentSpell.uid)).toMatchObject({
      location: "hand",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: blast.uid,
      reasonEffectId: 4,
    });
    expect(restoredQuick.session.state.cards.find((card) => card.uid === opponentFacedownDecoy.uid)).toMatchObject({ location: "spellTrapZone", controller: 1, faceUp: false });
    expect(restoredQuick.session.state.cards.find((card) => card.uid === ownSpellDecoy.uid)).toMatchObject({ location: "spellTrapZone", controller: 0 });
    expect(restoredQuick.session.state.eventHistory.filter((event) =>
      ["lifePointCostPaid", "becameTarget", "sentToHand"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: opponentMonster.uid, eventCode: 1028, eventName: "becameTarget", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventValue: 1, relatedEffectId: 3 },
      { eventCardUid: undefined, eventCode: 1201, eventName: "lifePointCostPaid", eventPlayer: 0, eventReason: duelReason.cost, eventReasonCardUid: blast.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, eventValue: 500, relatedEffectId: undefined },
      { eventCardUid: opponentSpell.uid, eventCode: 1028, eventName: "becameTarget", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventValue: 1, relatedEffectId: 4 },
      { eventCardUid: opponentSpell.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: blast.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, eventValue: undefined, relatedEffectId: undefined },
    ]);
    expect(restoredQuick.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSummonTrigger({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 89870349, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ownSpellDecoyCode], extra: [blastCode] }, 1: { main: [opponentMonsterCode, opponentSpellCode, opponentFacedownDecoyCode] } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(blastCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const blast = moveDuelCard(session.state, requireCard(session, blastCode).uid, "monsterZone", 0, duelReason.summon | duelReason.specialSummon, 0);
  blast.faceUp = true;
  blast.position = "faceUpAttack";
  blast.sequence = 0;
  blast.summonType = "special";
  blast.summonPlayer = 0;
  moveFaceUpAttack(session, requireCard(session, opponentMonsterCode), 1, 0);
  moveFaceUpSpell(session, requireCard(session, opponentSpellCode), 1, 0);
  moveFacedownSpell(session, requireCard(session, opponentFacedownDecoyCode), 1, 1);
  moveFaceUpSpell(session, requireCard(session, ownSpellDecoyCode), 0, 0);
  collectDuelTriggerEvent(session.state, "specialSummoned", blast, {
    eventReason: duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    eventPlayer: 0,
  });
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const blast = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === blastCode);
  expect(blast).toBeDefined();
  return [
    { ...blast!, kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceWarrior, attribute: attributeWind, level: 6, attack: 2200, defense: 1800 },
    { code: opponentMonsterCode, name: "Masked HERO Blast Halved Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 1000 },
    { code: opponentSpellCode, name: "Masked HERO Blast Opponent Spell", kind: "spell", typeFlags: typeSpell },
    { code: opponentFacedownDecoyCode, name: "Masked HERO Blast Opponent Facedown Decoy", kind: "spell", typeFlags: typeSpell },
    { code: ownSpellDecoyCode, name: "Masked HERO Blast Own Spell Decoy", kind: "spell", typeFlags: typeSpell },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Masked HERO Blast");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()/2)");
  expect(script).toContain("e3:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e3:SetCost(Cost.PayLP(500))");
  expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,0,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFacedownSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = false;
  moved.position = "faceDown";
  moved.sequence = sequence;
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
