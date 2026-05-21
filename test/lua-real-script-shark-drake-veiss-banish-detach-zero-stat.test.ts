import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const veissCode = "49221191";
const materialCode = "492211910";
const banishCostCode = "492211911";
const targetCode = "492211912";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasVeissScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${veissCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const attributeWater = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasVeissScript)("Lua real script Shark Drake Veiss banish detach zero stat", () => {
  it("restores banish plus detach cost into targeted final ATK/DEF zero", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${veissCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_WATER),4,4,s.ovfilter,aux.Stringid(id,0))");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("Duel.GetLP(tp)<=1000 and aux.StatChangeDamageStepCondition()");
    expect(script).toContain("e1:SetCost(Cost.AND(s.atkdefcost,Cost.DetachFromSelf(1)))");
    expect(script).toContain("Card.HasNonZeroAttack,Card.HasNonZeroDefense");
    expect(script).toContain("aux.SpElimFilter(c)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkdefcostfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.OR(Card.HasNonZeroAttack,Card.HasNonZeroDefense),tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("local ct=Duel.IsTurnPlayer(1-tp) and 2 or 1");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(0)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");

    const cards: DuelCardData[] = [
      { code: veissCode, name: "Number C32: Shark Drake Veiss", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, attribute: attributeWater, level: 4, attack: 0, defense: 0 },
      { code: materialCode, name: "Veiss Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
      { code: banishCostCode, name: "Veiss Grave Banish Cost", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWater, level: 4, attack: 1500, defense: 1200 },
      { code: targetCode, name: "Veiss Nonzero Target", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWater, level: 4, attack: 2300, defense: 1800 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 49221191, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, banishCostCode], extra: [veissCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const veiss = requireCard(session, veissCode);
    const material = requireCard(session, materialCode);
    const banishCost = requireCard(session, banishCostCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, veiss, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    veiss.overlayUids.push(material.uid);
    moveDuelCard(session.state, banishCost.uid, "graveyard", 0);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.players[0]!.lifePoints = 1000;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(veissCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === veiss.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === banishCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: veiss.uid,
      reasonEffectId: 2,
    });
    expect(restoredResolved.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: veiss.uid,
      reasonEffectId: 2,
    });
    expect(restoredResolved.session.state.cards.find((card) => card.uid === veiss.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === target.uid), restoredResolved.session.state)).toBe(0);
    expect(currentDefense(restoredResolved.session.state.cards.find((card) => card.uid === target.uid), restoredResolved.session.state)).toBe(0);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [102, 106].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, property: 0x400, reset: { count: 1, flags: 1107169792 }, value: 0 },
      { code: 106, property: 0x400, reset: { count: 1, flags: 1107169792 }, value: 0 },
    ]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === banishCost.uid).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        eventName: "banished",
        eventCardUid: banishCost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: veiss.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial" && event.eventCardUid === material.uid).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        eventName: "detachedMaterial",
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: veiss.uid,
        eventReasonEffectId: 2,
      },
    ]);
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
