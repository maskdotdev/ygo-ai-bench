import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const piercingCode = "21862633";
const hasPiercingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${piercingCode}.lua`));
const summonedNormalCode = "218626330";
const highLevelNormalCode = "218626331";
const defenderCode = "218626332";
const drawCardCode = "218626333";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeNormal = 0x10;
const typeContinuous = 0x20000;

describe.skipIf(!hasUpstreamScripts || !hasPiercingScript)("Lua real script Piercing the Darkness normal draw attack stat", () => {
  it("restores normal-monster Summon draw and attack-announcement ATK gain from the field Spell", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${piercingCode}.lua`);
    expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("return c:IsType(TYPE_NORMAL) and not c:IsType(TYPE_TOKEN) and c:IsSummonPlayer(tp)");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.SetTargetParam(1)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("e4:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(d:GetAttack())");
    expect(script).toContain("ge1:SetCode(EFFECT_MATERIAL_CHECK)");
    expect(script).toContain("c:RegisterFlagEffect(id,RESET_EVENT|(RESETS_STANDARD&~RESET_TOFIELD),0,1)");

    const cards: DuelCardData[] = [
      { code: piercingCode, name: "Piercing the Darkness", kind: "spell", typeFlags: typeSpell | typeContinuous },
      { code: summonedNormalCode, name: "Piercing Draw Normal", kind: "monster", typeFlags: typeMonster | typeNormal, level: 4, attack: 1400, defense: 1000 },
      { code: highLevelNormalCode, name: "Piercing High-Level Normal", kind: "monster", typeFlags: typeMonster | typeNormal, level: 5, attack: 1900, defense: 1500 },
      { code: defenderCode, name: "Piercing Battle Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000 },
      { code: drawCardCode, name: "Piercing Draw Card", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 21862633, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [piercingCode, summonedNormalCode, highLevelNormalCode, drawCardCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const piercing = requireCard(session, piercingCode);
    const summonedNormal = requireCard(session, summonedNormalCode);
    const highLevelNormal = requireCard(session, highLevelNormalCode);
    const defender = requireCard(session, defenderCode);
    const drawCard = requireCard(session, drawCardCode);
    moveDuelCard(session.state, piercing.uid, "spellTrapZone", 0).position = "faceUpAttack";
    piercing.faceUp = true;
    moveDuelCard(session.state, summonedNormal.uid, "hand", 0);
    moveDuelCard(session.state, highLevelNormal.uid, "monsterZone", 0).position = "faceUpAttack";
    highLevelNormal.faceUp = true;
    moveDuelCard(session.state, defender.uid, "monsterZone", 1).position = "faceUpAttack";
    defender.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(piercingCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === summonedNormal.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, summon!);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        effectId: "lua-2-1100",
        sourceUid: piercing.uid,
        triggerBucket: "turnOptional",
        eventName: "normalSummoned",
        eventPlayer: 0,
        eventCode: 1100,
        eventCardUid: summonedNormal.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredDrawTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredDrawTrigger);
    expectRestoredLegalActions(restoredDrawTrigger, 0);
    const drawTrigger = getLuaRestoreLegalActions(restoredDrawTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === piercing.uid);
    expect(drawTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDrawTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDrawTrigger, drawTrigger!);
    resolveRestoredChain(restoredDrawTrigger);
    expect(restoredDrawTrigger.session.state.cards.find((card) => card.uid === drawCard.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredDrawTrigger.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn")).toEqual([
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: drawCard.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: piercing.uid,
        eventReasonEffectId: 2,
        eventUids: [drawCard.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);

    restoredDrawTrigger.session.state.phase = "battle";
    restoredDrawTrigger.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredDrawTrigger.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === highLevelNormal.uid && action.targetUid === defender.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    expect(restoredBattle.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        player: 0,
        effectId: "lua-4-1130",
        sourceUid: piercing.uid,
        triggerBucket: "turnOptional",
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: highLevelNormal.uid,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventUids: [highLevelNormal.uid, defender.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredAttackTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredAttackTrigger);
    expectRestoredLegalActions(restoredAttackTrigger, 0);
    const attackTrigger = getLuaRestoreLegalActions(restoredAttackTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === piercing.uid);
    expect(attackTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredAttackTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredAttackTrigger, attackTrigger!);
    expect(restoredAttackTrigger.session.state.chain).toEqual([]);
    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === highLevelNormal.uid), restoredAttackTrigger.session.state)).toBe(3500);
    expect(restoredAttackTrigger.session.state.effects.filter((effect) => effect.sourceUid === highLevelNormal.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      id: effect.id,
      luaTypeFlags: effect.luaTypeFlags,
      range: effect.range,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      {
        code: 100,
        controller: 0,
        event: "continuous",
        id: "lua-6-100",
        luaTypeFlags: 1,
        range: ["monsterZone"],
        registryKey: "lua:21862633:lua-6-100",
        reset: { flags: 1107169792 },
        sourceUid: highLevelNormal.uid,
        value: 1600,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
