import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const greatTornadoCode = "3642509";
const polymerizationCode = "24094653";
const heroMaterialCode = "36425090";
const windMaterialCode = "36425091";
const ownMonsterCode = "36425092";
const opponentACode = "36425093";
const opponentBCode = "36425094";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasGreatTornadoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${greatTornadoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeEarth = 0x1;
const attributeWind = 0x8;
const setElementalHero = 0x3008;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasGreatTornadoScript)("Lua real script Great Tornado Fusion final stat", () => {
  it("restores Fusion.AddProcMix metadata into fusion-summoned opponent final ATK/DEF halving", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${greatTornadoCode}.lua`);
    expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_ELEMENTAL_HERO),aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_WIND))");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return e:GetHandler():IsFusionSummoned()");
    expect(script).toContain("e3:SetCode(EFFECT_SPSUMMON_CONDITION)");
    expect(script).toContain("e3:SetValue(aux.fuslimit)");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("for tc in aux.Next(tg) do");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(atk/2)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e2:SetValue(def/2)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [greatTornadoCode, polymerizationCode].includes(card.code)),
      { code: heroMaterialCode, name: "Great Tornado Elemental HERO Material", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attribute: attributeEarth, setcodes: [setElementalHero], attack: 1600, defense: 1200 },
      { code: windMaterialCode, name: "Great Tornado WIND Material", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attribute: attributeWind, attack: 1400, defense: 1000 },
      { code: ownMonsterCode, name: "Great Tornado Own Unaffected Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attribute: attributeEarth, attack: 1700, defense: 1300 },
      { code: opponentACode, name: "Great Tornado Opponent Target A", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attribute: attributeEarth, attack: 2400, defense: 2000 },
      { code: opponentBCode, name: "Great Tornado Opponent Target B", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attribute: attributeWind, attack: 1800, defense: 1600 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3642509, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [polymerizationCode, heroMaterialCode, windMaterialCode, ownMonsterCode], extra: [greatTornadoCode] },
      1: { main: [opponentACode, opponentBCode] },
    });
    startDuel(session);

    const polymerization = requireCard(session, polymerizationCode);
    const greatTornado = requireCard(session, greatTornadoCode);
    const heroMaterial = requireCard(session, heroMaterialCode);
    const windMaterial = requireCard(session, windMaterialCode);
    const ownMonster = requireCard(session, ownMonsterCode);
    const opponentA = requireCard(session, opponentACode);
    const opponentB = requireCard(session, opponentBCode);
    for (const card of [polymerization, heroMaterial, windMaterial]) moveDuelCard(session.state, card.uid, "hand", 0);
    moveFaceUpAttack(session, ownMonster, 0);
    moveFaceUpAttack(session, opponentA, 1);
    moveFaceUpAttack(session, opponentB, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(polymerizationCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(greatTornadoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(greatTornado.data.fusionRequiredMaterialPredicates).toEqual([{ setcode: setElementalHero }, { attribute: attributeWind }]);

    const directFusion = getLegalActions(session, 0).find(
      (action): action is Extract<DuelAction, { type: "fusionSummon" }> => action.type === "fusionSummon" && action.uid === greatTornado.uid,
    );
    expect(directFusion, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    expect(directFusion!.materialUids).toEqual([heroMaterial.uid, windMaterial.uid]);

    applyAndAssert(session, directFusion!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === greatTornado.uid)?.data.fusionRequiredMaterialPredicates).toEqual([
      { setcode: setElementalHero },
      { attribute: attributeWind },
    ]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === greatTornado.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "fusion",
      summonMaterialUids: [heroMaterial.uid, windMaterial.uid],
    });
    for (const material of [heroMaterial, windMaterial]) {
      expect(restoredTrigger.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.material | duelReason.fusion,
      });
    }
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
      sourceUid: trigger.sourceUid,
      player: trigger.player,
      triggerBucket: trigger.triggerBucket,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventCardUid: trigger.eventCardUid,
    }))).toEqual([
      {
        sourceUid: greatTornado.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: greatTornado.uid,
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === greatTornado.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ownMonster.uid), restoredTrigger.session.state)).toBe(1700);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === ownMonster.uid), restoredTrigger.session.state)).toBe(1300);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentA.uid), restoredTrigger.session.state)).toBe(1200);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === opponentA.uid), restoredTrigger.session.state)).toBe(1000);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentB.uid), restoredTrigger.session.state)).toBe(900);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === opponentB.uid), restoredTrigger.session.state)).toBe(800);
    expect(restoredTrigger.session.state.effects.filter((effect) => [opponentA.uid, opponentB.uid].includes(effect.sourceUid) && [102, 106].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      sourceUid: effect.sourceUid,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, sourceUid: opponentA.uid, reset: { flags: 33427456 }, value: 1200 },
      { code: 106, sourceUid: opponentA.uid, reset: { flags: 33427456 }, value: 1000 },
      { code: 102, sourceUid: opponentB.uid, reset: { flags: 33427456 }, value: 900 },
      { code: 106, sourceUid: opponentB.uid, reset: { flags: 33427456 }, value: 800 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        eventCardUid: greatTornado.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.fusion,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
      },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === ownMonster.uid && action.targetUid === opponentB.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 800 });
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(7200);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      passRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
