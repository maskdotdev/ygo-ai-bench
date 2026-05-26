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
const parroCode = "59577547";
const graveSalamangreatCode = "595775470";
const defenderCode = "595775471";
const attackerCode = "595775472";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasParroScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${parroCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeDark = 0x20;
const setSalamangreat = 0x119;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasParroScript)("Lua real script Salamangreat Parro attack summon stat recover", () => {
  it("restores opponent attack-announcement hand summon, Special Summon ATK copy, and self-tribute recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${parroCode}.lua`);
    expectParroScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 59577547, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [parroCode, graveSalamangreatCode, defenderCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const parro = requireCard(session, parroCode);
    const graveSalamangreat = requireCard(session, graveSalamangreatCode);
    const defender = requireCard(session, defenderCode);
    const attacker = requireCard(session, attackerCode);
    moveDuelCard(session.state, parro.uid, "hand", 0);
    moveDuelCard(session.state, graveSalamangreat.uid, "graveyard", 0);
    moveFaceUpAttack(session, defender, 0, 0);
    moveFaceUpAttack(session, attacker, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(parroCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === parro.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: 0x200, code: 1130, event: "trigger", property: undefined, range: ["hand"], triggerEvent: "attackDeclared", value: undefined },
      { category: 0x200000, code: 1102, event: "trigger", property: 0x10, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned", value: undefined },
      { category: 0x100000, code: undefined, event: "ignition", property: undefined, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-1-1130",
        eventCardUid: attacker.uid,
        eventName: "attackDeclared",
        eventPlayer: 1,
        eventReason: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: parro.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    const summonTrigger = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === parro.uid);
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonTrigger, summonTrigger!);
    resolveRestoredChain(restoredSummonTrigger);

    expect(restoredSummonTrigger.session.state.cards.find((card) => card.uid === parro.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: parro.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummonTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: parro.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: parro.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
    ]);
    expect(restoredSummonTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredAtkTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummonTrigger.session), workspace, reader);
    expectCleanRestore(restoredAtkTrigger);
    expectRestoredLegalActions(restoredAtkTrigger, 0);
    const atkTrigger = getLuaRestoreLegalActions(restoredAtkTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === parro.uid);
    expect(atkTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredAtkTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAtkTrigger, atkTrigger!);
    resolveRestoredChain(restoredAtkTrigger);

    expect(currentAttack(restoredAtkTrigger.session.state.cards.find((card) => card.uid === parro.uid), restoredAtkTrigger.session.state)).toBe(2800);
    expect(restoredAtkTrigger.session.state.effects.filter((effect) => effect.sourceUid === parro.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 33492992 }, sourceUid: parro.uid, value: 2800 },
    ]);
    expect(restoredAtkTrigger.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      relatedEffectId: event.relatedEffectId,
      eventChainDepth: event.eventChainDepth,
      eventChainLinkId: event.eventChainLinkId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: graveSalamangreat.uid, relatedEffectId: 2, eventChainDepth: 1, eventChainLinkId: "chain-6", previous: "deck", current: "graveyard" },
    ]);
    expect(restoredAtkTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    finishRestoredBattle(restoredAtkTrigger);
    expect(restoredAtkTrigger.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredAtkTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredRecover = restoreDuelWithLuaScripts(serializeDuel(restoredAtkTrigger.session), workspace, reader);
    expectCleanRestore(restoredRecover);
    restoredRecover.session.state.phase = "main1";
    restoredRecover.session.state.turnPlayer = 0;
    restoredRecover.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredRecover, 0);
    const recover = getLuaRestoreLegalActions(restoredRecover, 0).find((action) => action.type === "activateEffect" && action.uid === parro.uid);
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(restoredRecover, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRecover, recover!);
    resolveRestoredChain(restoredRecover);

    expect(restoredRecover.session.state.cards.find((card) => card.uid === parro.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: parro.uid,
      reasonEffectId: 3,
    });
    expect(restoredRecover.session.state.players[0].lifePoints).toBe(10000);
    expect(restoredRecover.session.state.eventHistory.filter((event) => ["released", "recoveredLifePoints"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "released", eventCardUid: parro.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: parro.uid, eventReasonEffectId: 3, previous: "monsterZone", current: "graveyard" },
      { eventName: "recoveredLifePoints", eventCardUid: undefined, eventPlayer: 0, eventValue: 2000, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: parro.uid, eventReasonEffectId: 3, previous: undefined, current: undefined },
    ]);
    expect(restoredRecover.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectParroScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("return Duel.GetAttacker():IsControler(1-tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,tp,LOCATION_HAND)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_ATTACK)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsMonster() and c:IsSetCard(SET_SALAMANGREAT) and c:GetAttack()~=atk");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,c:GetAttack())");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack())");
  expect(script).toContain("e3:SetCategory(CATEGORY_RECOVER)");
  expect(script).toContain("e3:SetCost(Cost.SelfTribute)");
  expect(script).toContain("Duel.SetTargetPlayer(tp)");
  expect(script).toContain("Duel.SetTargetParam(2000)");
  expect(script).toContain("Duel.Recover(p,d,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: parroCode, name: "Salamangreat Parro", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeFire, setcodes: [setSalamangreat], level: 5, attack: 2000, defense: 1000 },
    { code: graveSalamangreatCode, name: "Salamangreat Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeFire, setcodes: [setSalamangreat], level: 4, attack: 2800, defense: 1000 },
    { code: defenderCode, name: "Salamangreat Parro Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
    { code: attackerCode, name: "Salamangreat Parro Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
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

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const actions = getLuaRestoreLegalActions(restored, player);
    const pass = actions.find((action) => action.type === passType)
      ?? actions.find((action) => action.type === "cancelAttack")
      ?? actions.find((action) => action.type === "replayAttack");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
