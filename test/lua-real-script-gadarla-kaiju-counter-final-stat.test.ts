import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const gadarlaCode = "36956512";
const allyCode = "369565120";
const opponentCode = "369565121";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasGadarlaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gadarlaCode}.lua`));
const kaijuCounter = 0x37;
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasGadarlaScript)("Lua real script Gadarla Kaiju counter final stat", () => {
  it("restores Kaiju counter cost into damage-step-capable final ATK/DEF halving", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gadarlaCode}.lua`);
    expect(script).toContain("local e1,e2=aux.AddKaijuProcedure(c)");
    expect(script).toContain("e3:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e3:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("Duel.IsCanRemoveCounter(tp,1,1,COUNTER_KAIJU,3,REASON_COST)");
    expect(script).toContain("Duel.RemoveCounter(tp,1,1,COUNTER_KAIJU,3,REASON_COST)");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,c)");
    expect(script).toContain("for tc in aux.Next(tg) do");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(atk/2)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e2:SetValue(def/2)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gadarlaCode),
      { code: allyCode, name: "Gadarla Ally Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2200, defense: 1800 },
      { code: opponentCode, name: "Gadarla Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2600, defense: 2400 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 36956512, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gadarlaCode, allyCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const gadarla = requireCard(session, gadarlaCode);
    const ally = requireCard(session, allyCode);
    const opponent = requireCard(session, opponentCode);
    moveFaceUpAttack(session, gadarla, 0);
    moveFaceUpAttack(session, ally, 0);
    moveFaceUpAttack(session, opponent, 1);
    expect(addDuelCardCounter(gadarla, kaijuCounter, 3)).toBe(true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gadarlaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === gadarla.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(getDuelCardCounter(restoredOpen.session.state.cards.find((card) => card.uid === gadarla.uid), kaijuCounter)).toBe(0);
    passRestoredChain(restoredOpen);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "counterRemoved" && event.eventCardUid === gadarla.uid).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        eventName: "counterRemoved",
        eventCardUid: gadarla.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: gadarla.uid,
        eventReasonEffectId: 3,
      },
    ]);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === gadarla.uid), restoredResolved.session.state)).toBe(gadarla.data.attack ?? 0);
    expect(currentDefense(restoredResolved.session.state.cards.find((card) => card.uid === gadarla.uid), restoredResolved.session.state)).toBe(gadarla.data.defense ?? 0);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === ally.uid), restoredResolved.session.state)).toBe(1100);
    expect(currentDefense(restoredResolved.session.state.cards.find((card) => card.uid === ally.uid), restoredResolved.session.state)).toBe(900);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === opponent.uid), restoredResolved.session.state)).toBe(1300);
    expect(currentDefense(restoredResolved.session.state.cards.find((card) => card.uid === opponent.uid), restoredResolved.session.state)).toBe(1200);
    expect(restoredResolved.session.state.effects.filter((effect) => [ally.uid, opponent.uid].includes(effect.sourceUid) && [102, 106].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      sourceUid: effect.sourceUid,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, sourceUid: ally.uid, reset: { flags: 33427456 }, value: 1100 },
      { code: 106, sourceUid: ally.uid, reset: { flags: 33427456 }, value: 900 },
      { code: 102, sourceUid: opponent.uid, reset: { flags: 33427456 }, value: 1300 },
      { code: 106, sourceUid: opponent.uid, reset: { flags: 33427456 }, value: 1200 },
    ]);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredResolved.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === ally.uid && action.targetUid === opponent.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 200, 1: 0 });
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(7800);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(8000);
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
