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
const juragedoCode = "59546797";
const attackerCode = "595467970";
const defenderCode = "595467971";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasJuragedoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${juragedoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const eventSpecialSummonSuccess = 1102;
const eventRelease = 1017;
const eventRecover = 1112;

describe.skipIf(!hasUpstreamScripts || !hasJuragedoScript)("Lua real script Juragedo battle step summon recover tribute stat", () => {
  it("restores Battle Step hand summon recovery and SelfTribute target ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${juragedoCode}.lua`);
    expectJuragedoScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 59546797, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [juragedoCode, attackerCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const juragedo = requireCard(session, juragedoCode);
    const attacker = requireCard(session, attackerCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, juragedo.uid, "hand", 0);
    juragedo.sequence = 0;
    moveFaceUpAttack(session, attacker, 0, 0);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(juragedoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === juragedo.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: 1049088, code: 1002, event: "quick", property: undefined, range: ["hand"], triggerEvent: undefined },
      { category: 2097152, code: 1002, event: "quick", property: 16400, range: ["monsterZone"], triggerEvent: undefined },
    ]);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passRestoredBattleAction(restoredBattle, 1, "passAttack");
    expectRestoredLegalActions(restoredBattle, 0);

    const summonRecover = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "activateEffect" && action.uid === juragedo.uid && action.effectId === "lua-1-1002"
    );
    expect(summonRecover, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, summonRecover!);
    resolveRestoredChain(restoredBattle);

    expect(restoredBattle.session.state.cards.find((card) => card.uid === juragedo.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: juragedo.uid,
      reasonEffectId: 1,
      sequence: 1,
    });
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(9000);
    expect(restoredBattle.session.state.eventHistory.filter((event) => ["specialSummoned", "recoveredLifePoints"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: eventSpecialSummonSuccess,
        eventCardUid: juragedo.uid,
        eventUids: [juragedo.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: juragedo.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "recoveredLifePoints",
        eventCode: eventRecover,
        eventPlayer: 0,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: juragedo.uid,
        eventReasonEffectId: 1,
      },
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 1);
    passRestoredBattleAction(restoredBoost, 1, "passAttack");
    expectRestoredLegalActions(restoredBoost, 0);
    const boost = getLuaRestoreLegalActions(restoredBoost, 0).find((action) =>
      action.type === "activateEffect" && action.uid === juragedo.uid && action.effectId === "lua-2-1002"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, boost!);
    resolveRestoredChain(restoredBoost);

    expect(restoredBoost.session.state.cards.find((card) => card.uid === juragedo.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: juragedo.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === attacker.uid), restoredBoost.session.state)).toBe(2800);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792, count: 2 }, sourceUid: attacker.uid, value: 1000 },
    ]);
    expect(restoredBoost.session.state.eventHistory.filter((event) => ["released", "becameTarget"].includes(event.eventName))).toEqual([
      {
        eventName: "released",
        eventCode: eventRelease,
        eventCardUid: juragedo.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: juragedo.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: attacker.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-8",
        relatedEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredBoost.session.state.players[0].lifePoints).toBe(9000);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectJuragedoScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_RECOVER)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("return Duel.IsPhase(PHASE_BATTLE_STEP)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,tp,1000)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.Recover(tp,1000,REASON_EFFECT)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e2:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("e2:SetCost(Cost.SelfTribute)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END,2)");
}

function cards(): DuelCardData[] {
  return [
    { code: juragedoCode, name: "Juragedo", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1700, defense: 1300 },
    { code: attackerCode, name: "Juragedo Battle Target Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1200 },
    { code: defenderCode, name: "Juragedo Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
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

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, type: "passAttack" | "passDamage"): void {
  expectRestoredLegalActions(restored, player);
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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
