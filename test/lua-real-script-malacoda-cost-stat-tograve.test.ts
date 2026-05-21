import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const malacodaCode = "35330871";
const costCode = "353308710";
const opponentCode = "353308711";
const toGraveTargetCode = "353308712";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMalacodaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${malacodaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeRitual = 0x80;
const typeSpell = 0x2;
const setBurningAbyss = 0xb1;

describe.skipIf(!hasUpstreamScripts || !hasMalacodaScript)("Lua real script Malacoda cost stat and to-grave trigger", () => {
  it("restores ritual revive limit, BA hand cost stat drop, and delayed previous-field SendtoGrave trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${malacodaCode}.lua`);
    expect(script).toContain("e1:SetValue(aux.ritlimit)");
    expect(script).toContain("e2:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_HAND,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
    expect(script).toContain("local atk=cc:GetAttack()");
    expect(script).toContain("local def=cc:GetDefense()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToGrave,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === malacodaCode),
      { code: costCode, name: "Malacoda Burning Abyss Cost", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBurningAbyss], level: 3, attack: 700, defense: 900 },
      { code: opponentCode, name: "Malacoda Face-up Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1600 },
      { code: toGraveTargetCode, name: "Malacoda To-Grave Target", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const source = { readScript(name: string) { return workspace.readScript(name); } };

    const statSession = createDuel({ seed: 35330871, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(statSession, { 0: { main: [malacodaCode, costCode] }, 1: { main: [opponentCode] } });
    startDuel(statSession);
    const statMalacoda = requireCard(statSession, malacodaCode);
    const cost = requireCard(statSession, costCode);
    const opponent = requireCard(statSession, opponentCode);
    moveFaceUpAttack(statSession, statMalacoda, 0);
    moveDuelCard(statSession.state, cost.uid, "hand", 0);
    moveFaceUpAttack(statSession, opponent, 1);
    statSession.state.phase = "main1";
    statSession.state.turnPlayer = 0;
    statSession.state.waitingFor = 0;

    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(malacodaCode), source).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(1);
    expect(statSession.state.effects.find((effect) => effect.sourceUid === statMalacoda.uid && effect.code === 30)).toMatchObject({
      luaValueDescriptor: "special-summon-condition:type:1157627904",
    });

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(statSession), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const statDrop = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === statMalacoda.uid && action.effectId === "lua-3-1002");
    expect(statDrop, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, statDrop!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: statMalacoda.uid,
      reasonEffectId: 3,
    });
    const restoredOpponent = restoredOpen.session.state.cards.find((card) => card.uid === opponent.uid)!;
    expect(currentAttack(restoredOpponent, restoredOpen.session.state)).toBe(1100);
    expect(currentDefense(restoredOpponent, restoredOpen.session.state)).toBe(700);
    expect(restoredOpen.session.state.eventHistory.some((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === cost.uid)).toBe(true);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === opponent.uid && [100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1107169792 }, value: -700 },
      { code: 104, reset: { flags: 1107169792 }, value: -900 },
    ]);

    const triggerSession = createDuel({ seed: 35330872, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(triggerSession, { 0: { main: [malacodaCode, toGraveTargetCode] }, 1: { main: [opponentCode] } });
    startDuel(triggerSession);
    const triggerMalacoda = requireCard(triggerSession, malacodaCode);
    const toGraveTarget = requireCard(triggerSession, toGraveTargetCode);
    moveFaceUpAttack(triggerSession, triggerMalacoda, 0);
    moveDuelCard(triggerSession.state, toGraveTarget.uid, "spellTrapZone", 1).faceUp = true;
    triggerSession.state.phase = "main1";
    triggerSession.state.turnPlayer = 0;
    triggerSession.state.waitingFor = 0;
    const triggerHost = createLuaScriptHost(triggerSession, workspace);
    expect(triggerHost.loadCardScript(Number(malacodaCode), source).ok).toBe(true);
    expect(triggerHost.registerInitialEffects()).toBe(1);
    destroyDuelCard(triggerSession.state, triggerMalacoda.uid, 0, duelReason.effect | duelReason.destroy, 1, "graveyard", { eventReasonCardUid: opponent.uid });
    const triggerWindow = restoreDuelWithLuaScripts(serializeDuel(triggerSession), source, reader);
    expectCleanRestore(triggerWindow);
    expectRestoredLegalActions(triggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(triggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === triggerMalacoda.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(triggerWindow, 0), null, 2)).toBeDefined();
    expect(getLuaRestoreLegalActions(triggerWindow, 0).some((action) => "operationInfos" in action)).toBe(false);
    expect(trigger).toMatchObject({
      type: "activateTrigger",
      player: 0,
      uid: triggerMalacoda.uid,
      effectId: "lua-4-1014",
      triggerBucket: "turnOptional",
    });
    applyRestoredActionAndAssert(triggerWindow, trigger!);
    expect(triggerWindow.session.state.cards.find((card) => card.uid === toGraveTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: triggerMalacoda.uid,
      reasonEffectId: 4,
    });
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
