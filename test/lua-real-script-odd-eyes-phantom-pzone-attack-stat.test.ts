import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const phantomCode = "93149655";
const hasPhantomScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${phantomCode}.lua`));
const otherScaleCode = "931496550";
const defenderCode = "931496551";
const attackerCode = "931496553";
const pendulumType = 0x1000001;
const typeMonster = 0x1;
const setOddEyes = 0x99;
const summonTypePendulum = 0x4a000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPhantomScript)("Lua real script Odd-Eyes Phantom PZONE attack stat", () => {
  it("restores PZONE attack-announcement targeting into a temporary battle ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${phantomCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
    expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsSetCard,tp,LOCATION_PZONE,0,1,e:GetHandler(),SET_ODD_EYES)");
    expect(script).toContain("e:SetLabelObject(a)");
    expect(script).toContain("Duel.SetTargetCard(tc)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1200)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("return ep~=tp and e:GetHandler():IsPendulumSummoned()");
    expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsSetCard,SET_ODD_EYES),tp,LOCATION_PZONE,0,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,ct*1200)");
    expect(script).toContain("Duel.Damage(1-tp,ct*1200,REASON_EFFECT)");

    const phantomData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === phantomCode);
    expect(phantomData).toBeDefined();
    const cards: DuelCardData[] = [
      phantomData!,
      { code: otherScaleCode, name: "Odd-Eyes Phantom Other Scale", kind: "monster", typeFlags: pendulumType, setcodes: [setOddEyes], level: 4, attack: 1000, defense: 1000 },
      { code: attackerCode, name: "Odd-Eyes Phantom Battle Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
      { code: defenderCode, name: "Odd-Eyes Phantom Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 93149655, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [phantomCode, otherScaleCode, attackerCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const scalePhantom = requireCard(session, phantomCode);
    const otherScale = requireCard(session, otherScaleCode);
    const attacker = requireCard(session, attackerCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, scalePhantom.uid, "spellTrapZone", 0).sequence = 0;
    scalePhantom.position = "faceUpAttack";
    scalePhantom.faceUp = true;
    moveDuelCard(session.state, otherScale.uid, "spellTrapZone", 0).sequence = 1;
    otherScale.position = "faceUpAttack";
    otherScale.faceUp = true;
    moveDuelCard(session.state, attacker.uid, "monsterZone", 0).position = "faceUpAttack";
    attacker.faceUp = true;
    moveDuelCard(session.state, defender.uid, "monsterZone", 1).position = "faceUpAttack";
    defender.faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(phantomCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1130",
        sourceUid: scalePhantom.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: attacker.uid,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventUids: [attacker.uid, defender.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        effectLabelObjectUid: attacker.uid,
      },
    ]);

    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const pzoneTrigger = getLuaRestoreLegalActions(restoredAttack, 0).find((action) => action.type === "activateTrigger" && action.uid === scalePhantom.uid);
    expect(pzoneTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredAttack, pzoneTrigger!);
    expect(restoredAttack.session.state.chain).toEqual([]);
    expect(currentAttack(restoredAttack.session.state.cards.find((card) => card.uid === attacker.uid), restoredAttack.session.state)).toBe(3000);
    expect(restoredAttack.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      id: effect.id,
      luaTypeFlags: effect.luaTypeFlags,
      oncePerTurn: effect.oncePerTurn,
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
        id: "lua-5-100",
        luaTypeFlags: 1,
        oncePerTurn: false,
        range: ["monsterZone"],
        registryKey: "lua:93149655:lua-5-100",
        reset: { flags: 1107169408 },
        sourceUid: attacker.uid,
        value: 1200,
      },
    ]);
    expect(restoredAttack.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredAttack.session.state.eventHistory.filter((event) => event.eventName === "becameTarget" || event.eventName === "chainSolved")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCardUid: attacker.uid,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);
  });

  it("restores Pendulum-Summoned battle-damage trigger into Odd-Eyes PZONE effect damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${phantomCode}.lua`);
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("return ep~=tp and e:GetHandler():IsPendulumSummoned()");
    expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsSetCard,SET_ODD_EYES),tp,LOCATION_PZONE,0,nil)");
    expect(script).toContain("Duel.Damage(1-tp,ct*1200,REASON_EFFECT)");

    const phantomData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === phantomCode);
    expect(phantomData).toBeDefined();
    const cards: DuelCardData[] = [
      phantomData!,
      { code: otherScaleCode, name: "Odd-Eyes Phantom Other Scale", kind: "monster", typeFlags: pendulumType, setcodes: [setOddEyes], level: 4, attack: 1000, defense: 1000 },
      { code: defenderCode, name: "Odd-Eyes Phantom Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 93149656, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [phantomCode, otherScaleCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const phantom = requireCard(session, phantomCode);
    const otherScale = requireCard(session, otherScaleCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, phantom.uid, "hand", 0);
    moveDuelCard(session.state, otherScale.uid, "spellTrapZone", 0).sequence = 1;
    otherScale.position = "faceUpAttack";
    otherScale.faceUp = true;
    moveDuelCard(session.state, defender.uid, "monsterZone", 1).position = "faceUpAttack";
    defender.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(phantomCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    specialSummonDuelCard(session.state, phantom.uid, 0, 0, {}, summonTypePendulum);
    expect(session.state.cards.find((card) => card.uid === phantom.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "pendulum",
      summonTypeCode: summonTypePendulum,
    });
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === phantom.uid && action.targetUid === defender.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    passBattleUntilTrigger(restoredBattle);

    expect(restoredBattle.session.state.players[1].lifePoints).toBe(6500);
    expect(restoredBattle.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        effectId: "lua-4-1143",
        eventCardUid: phantom.uid,
        eventCode: 1143,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleDamageDealt",
        eventPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventReason: duelReason.battle,
        eventReasonCardUid: phantom.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventValue: 1500,
        player: 0,
        sourceUid: phantom.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const damageTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === phantom.uid);
    expect(damageTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(("operationInfos" in damageTrigger! ? damageTrigger!.operationInfos : []) ?? []).toEqual([]);
    applyLuaRestoreAndAssert(restoredTrigger, damageTrigger!);

    expect(restoredTrigger.session.state.players[1].lifePoints).toBe(5300);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: phantom.uid,
        eventPlayer: 1,
        eventValue: 1500,
        eventReason: duelReason.battle,
        eventReasonCardUid: phantom.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1200,
        eventReason: duelReason.effect,
        eventReasonCardUid: phantom.uid,
        eventReasonEffectId: 4,
        eventReasonPlayer: 0,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
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

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
