import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const unicornCode = "86157908";
const oddEyesAttackerCode = "861579080";
const performapalTargetCode = "861579081";
const defenderCode = "861579082";
const gravePerformapalCode = "861579083";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUnicornScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${unicornCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceBeast = 0x4000;
const raceDragon = 0x2000;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;
const attributeEarth = 0x10;
const setOddEyes = 0x99;
const setPerformapal = 0x9f;
const effectUpdateAttack = 100;
const eventAttackAnnounce = 1130;
const eventSpecialSummonSuccess = 1102;
const eventRecover = 1112;

describe.skipIf(!hasUpstreamScripts || !hasUnicornScript)("Lua real script Performapal Odd-Eyes Unicorn PZone attack summon recover stat", () => {
  it("restores PZone Odd-Eyes attack boost and Special Summon Performapal recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${unicornCode}.lua`);
    expectUnicornScriptShape(script);
    const reader = createCardReader(cards());

    const restoredBattle = createRestoredPzoneBattle({ reader, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const pzoneUnicorn = requireCard(restoredBattle.session, unicornCode);
    const oddEyesAttacker = requireCard(restoredBattle.session, oddEyesAttackerCode);
    const performapalTarget = requireCard(restoredBattle.session, performapalTargetCode);
    const defender = requireCard(restoredBattle.session, defenderCode);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === oddEyesAttacker.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1130",
        eventCardUid: oddEyesAttacker.uid,
        eventCode: eventAttackAnnounce,
        eventName: "attackDeclared",
        eventPlayer: 0,
        eventReason: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: pzoneUnicorn.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredAttackTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredAttackTrigger);
    expectRestoredLegalActions(restoredAttackTrigger, 0);
    const attackBoost = getLuaRestoreLegalActions(restoredAttackTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === pzoneUnicorn.uid);
    expect(attackBoost, JSON.stringify(getLuaRestoreLegalActions(restoredAttackTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackTrigger, attackBoost!);
    resolveRestoredChain(restoredAttackTrigger);

    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === oddEyesAttacker.uid), restoredAttackTrigger.session.state)).toBe(3300);
    expect(restoredAttackTrigger.session.state.effects.filter((effect) => effect.sourceUid === oddEyesAttacker.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169408 }, sourceUid: oddEyesAttacker.uid, value: 1800 },
    ]);
    expect(restoredAttackTrigger.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      relatedEffectId: event.relatedEffectId,
      eventChainDepth: event.eventChainDepth,
      eventChainLinkId: event.eventChainLinkId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: performapalTarget.uid, relatedEffectId: 3, eventChainDepth: 1, eventChainLinkId: "chain-3", previous: "deck", current: "monsterZone" },
    ]);
    expect(restoredAttackTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredSummon = createRestoredSpecialSummonRecover({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summonedUnicorn = requireCard(restoredSummon.session, unicornCode);
    const gravePerformapal = requireCard(restoredSummon.session, gravePerformapalCode);
    expect(restoredSummon.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventReasonPlayer: trigger.eventReasonPlayer,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-5-1102",
        eventCardUid: summonedUnicorn.uid,
        eventCode: eventSpecialSummonSuccess,
        eventName: "specialSummoned",
        eventPlayer: 0,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonCardUid: summonedUnicorn.uid,
        eventReasonEffectId: 900,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: summonedUnicorn.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    const recover = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "activateTrigger" && action.uid === summonedUnicorn.uid);
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, recover!);
    resolveRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.players[0].lifePoints).toBe(9200);
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget", "recoveredLifePoints"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: eventSpecialSummonSuccess, eventCardUid: summonedUnicorn.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: summonedUnicorn.uid, eventReasonEffectId: 900, relatedEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: gravePerformapal.uid, eventPlayer: undefined, eventValue:  1, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 5, previous: "deck", current: "graveyard" },
      { eventName: "recoveredLifePoints", eventCode: eventRecover, eventCardUid: undefined, eventPlayer: 0, eventValue: 1200, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: summonedUnicorn.uid, eventReasonEffectId: 5, relatedEffectId: undefined, previous: undefined, current: undefined },
    ]);
  });
});

function createRestoredPzoneBattle({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 86157908, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [unicornCode, oddEyesAttackerCode, performapalTargetCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  movePzone(session, requireCard(session, unicornCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, oddEyesAttackerCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, performapalTargetCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(unicornCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredSpecialSummonRecover({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 86157909, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [unicornCode, gravePerformapalCode] }, 1: { main: [] } });
  startDuel(session);
  const unicorn = requireCard(session, unicornCode);
  const gravePerformapal = requireCard(session, gravePerformapalCode);
  moveDuelCard(session.state, unicorn.uid, "hand", 0);
  moveDuelCard(session.state, gravePerformapal.uid, "graveyard", 0).faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(unicornCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  specialSummonDuelCard(session.state, unicorn.uid, 0, 0, { eventReasonCardUid: unicorn.uid, eventReasonEffectId: 900 }, 0, true, true);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectUnicornScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_NO_TURN_RESET+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e2:SetRange(LOCATION_PZONE)");
  expect(script).toContain("return at:IsControler(tp) and at:IsSetCard(SET_ODD_EYES)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,at)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(atk)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_BATTLE)");
  expect(script).toContain("e3:SetCategory(CATEGORY_RECOVER)");
  expect(script).toContain("e3:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e4:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,tp,atk)");
  expect(script).toContain("Duel.Recover(tp,tc:GetAttack(),REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: unicornCode, name: "Performapal Odd-Eyes Unicorn", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceBeast, attribute: attributeLight, setcodes: [setPerformapal, setOddEyes], level: 1, attack: 100, defense: 600, leftScale: 8, rightScale: 8 },
    { code: oddEyesAttackerCode, name: "Unicorn Odd-Eyes Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, setcodes: [setOddEyes], level: 4, attack: 1500, defense: 1000 },
    { code: performapalTargetCode, name: "Unicorn Performapal ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, setcodes: [setPerformapal], level: 4, attack: 1800, defense: 1000 },
    { code: defenderCode, name: "Unicorn Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: gravePerformapalCode, name: "Unicorn Grave Performapal", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, setcodes: [setPerformapal], level: 4, attack: 1200, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function movePzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
