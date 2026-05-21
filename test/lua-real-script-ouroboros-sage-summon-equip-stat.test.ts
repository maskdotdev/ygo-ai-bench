import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const ouroborosSageCode = "32281491";
const utopiaAllyCode = "322814910";
const numberTargetCode = "322814911";
const defenderCode = "322814912";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const setUtopia = 0x107f;
const setNumber = 0x48;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script ZS Ouroboros Sage summon equip stat", () => {
  it("restores summon trigger into non-LIGHT Number revive, dual equips, disables, and equip ATK gains", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ouroborosSageCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_EQUIP)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("return c:IsSetCard(SET_NUMBER) and c:IsAttributeExcept(ATTRIBUTE_LIGHT)");
    expect(script).toContain("Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("Duel.SpecialSummonComplete()");
    expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
    expect(script).toContain("aux.EquipAndLimitRegister(ec,e,tp,tc)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1700)");
    expect(script).toContain("e2:SetCode(EFFECT_EQUIP_LIMIT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ouroborosSageCode),
      { code: utopiaAllyCode, name: "Ouroboros Sage Utopia Ally", kind: "extra", typeFlags: typeMonster | typeXyz, setcodes: [setUtopia], level: 4, attack: 2500, defense: 2000 },
      { code: numberTargetCode, name: "Ouroboros Sage DARK Number Target", kind: "extra", typeFlags: typeMonster | typeXyz, setcodes: [setNumber], attribute: attributeDark, level: 4, attack: 2000, defense: 1000 },
      { code: defenderCode, name: "Ouroboros Sage Defender", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 5000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 32281491, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ouroborosSageCode], extra: [utopiaAllyCode, numberTargetCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const ouroborosSage = requireCard(session, ouroborosSageCode);
    const utopiaAlly = requireCard(session, utopiaAllyCode);
    const numberTarget = requireCard(session, numberTargetCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, ouroborosSage.uid, "hand", 0);
    moveFaceUpAttack(session, utopiaAlly, 0);
    moveDuelCard(session.state, numberTarget.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, defender, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    const loaded = host.loadCardScript(Number(ouroborosSageCode), workspace);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === ouroborosSage.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    expect(restoredSummon.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        effectId: "lua-1-1100",
        sourceUid: ouroborosSage.uid,
        triggerBucket: "turnOptional",
        eventName: "normalSummoned",
        eventPlayer: 0,
        eventCode: 1100,
        eventCardUid: ouroborosSage.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === ouroborosSage.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === numberTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: ouroborosSage.uid,
      reasonEffectId: 1,
      reasonPlayer: 0,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === ouroborosSage.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      equippedToUid: numberTarget.uid,
      faceUp: true,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === utopiaAlly.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      equippedToUid: numberTarget.uid,
      faceUp: true,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === numberTarget.uid), restoredTrigger.session.state)).toBe(5400);
    expect(restoredTrigger.session.state.effects.filter((effect) => [numberTarget.uid, ouroborosSage.uid, utopiaAlly.uid].includes(effect.sourceUid) && [7, 8, 76, 100].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 8, registryKey: "lua:32281491:lua-4-8", reset: { flags: 33427456 }, sourceUid: numberTarget.uid, value: 131072 },
      { code: 76, registryKey: "lua:32281491:lua-5-76", reset: { flags: 33427456 }, sourceUid: ouroborosSage.uid, value: undefined },
      { code: 100, registryKey: "lua:32281491:lua-6-100", reset: { flags: 33427456 }, sourceUid: ouroborosSage.uid, value: 1700 },
      { code: 76, registryKey: "lua:32281491:lua-7-76", reset: { flags: 33427456 }, sourceUid: ouroborosSage.uid, value: undefined },
      { code: 76, registryKey: "lua:322814910:lua-8-76", reset: { flags: 33427456 }, sourceUid: utopiaAlly.uid, value: undefined },
      { code: 100, registryKey: "lua:322814910:lua-9-100", reset: { flags: 33427456 }, sourceUid: utopiaAlly.uid, value: 1700 },
      { code: 76, registryKey: "lua:322814910:lua-10-76", reset: { flags: 33427456 }, sourceUid: utopiaAlly.uid, value: undefined },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "equipped"].includes(event.eventName))).toEqual([
      {
        eventName: "equipped",
        eventCode: 1121,
        eventCardUid: ouroborosSage.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ouroborosSage.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "equipped",
        eventCode: 1121,
        eventCardUid: utopiaAlly.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ouroborosSage.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: numberTarget.uid,
        eventUids: [numberTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: ouroborosSage.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 2,
        },
      },
    ]);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    restoredTrigger.session.state.phase = "battle";
    restoredTrigger.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => (
      action.type === "declareAttack" &&
      action.attackerUid === numberTarget.uid &&
      action.targetUid === defender.uid
    ));
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);

    expect(restoredBattle.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-9-1",
        player: 0,
        sourceUid: ouroborosSage.uid,
        effectId: "lua-11-1130",
        eventName: "attackDeclared",
        triggerBucket: "turnOptional",
        eventTriggerTiming: "when",
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: ouroborosSage.uid,
        eventReasonEffectId: 1,
        eventCode: 1130,
        eventPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 2,
        },
        eventCardUid: numberTarget.uid,
      },
    ]);
    const restoredAttackTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredAttackTrigger);
    expectRestoredLegalActions(restoredAttackTrigger, 0);
    const doubleAttack = getLuaRestoreLegalActions(restoredAttackTrigger, 0).find((action) => (
      action.type === "activateTrigger" &&
      action.uid === ouroborosSage.uid &&
      action.effectId === "lua-11-1130"
    ));
    expect(doubleAttack, JSON.stringify(getLuaRestoreLegalActions(restoredAttackTrigger, 0), null, 2)).toBeDefined();
    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === numberTarget.uid), restoredAttackTrigger.session.state)).toBe(5400);
    applyRestoredActionAndAssert(restoredAttackTrigger, doubleAttack!);
    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === numberTarget.uid), restoredAttackTrigger.session.state)).toBe(10800);
    expect(restoredAttackTrigger.session.state.effects.filter((effect) => effect.code === 102)).toEqual([
      {
        id: "lua-11-1130-set-attack-final",
        sourceUid: numberTarget.uid,
        controller: 0,
        event: "continuous",
        code: 102,
        value: 10800,
        range: ["monsterZone"],
        reset: { flags: 33427456 },
        operation: expect.any(Function),
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: ReturnType<typeof requireCard>, player: PlayerId): void {
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
