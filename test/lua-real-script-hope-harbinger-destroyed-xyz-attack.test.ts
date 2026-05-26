import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hopeCode = "63767246";
const destroyedXyzCode = "637672460";
const ownNonXyzCode = "637672461";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHopeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hopeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasHopeScript)("Lua real script Number 38 destroyed Xyz attack", () => {
  it("restores destroyed own Xyz trigger into target Xyz ATK gain from destroyed base ATK", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${hopeCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,8,2)");
    expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
    expect(script).toContain("Duel.NegateEffect(ev)");
    expect(script).toContain("Duel.Overlay(c,rc,true)");
    expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("Duel.CalculateDamage(at,c)");
    expect(script).toContain("e3:SetCategory(CATEGORY_ATKCHANGE)");
    expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
    expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("c:IsReason(REASON_BATTLE|REASON_EFFECT) and c:IsType(TYPE_XYZ) and c:GetBaseAttack()>0");
    expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsType,TYPE_XYZ),tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(g:GetFirst():GetBaseAttack())");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 63767246, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ownNonXyzCode], extra: [hopeCode, destroyedXyzCode] }, 1: { main: [] } });
    startDuel(session);

    const hope = requireCard(session, hopeCode);
    const destroyedXyz = requireCard(session, destroyedXyzCode);
    const ownNonXyz = requireCard(session, ownNonXyzCode);
    moveFaceUpAttack(session, hope, 0);
    hope.summonType = "xyz";
    moveFaceUpAttack(session, destroyedXyz, 0);
    destroyedXyz.summonType = "xyz";
    moveFaceUpAttack(session, ownNonXyz, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hopeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    destroyDuelCard(restoredOpen.session.state, destroyedXyz.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredOpen.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === hope.uid)).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-4-1029",
        sourceUid: hope.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "destroyed",
        eventCode: 1029,
        eventPlayer: 0,
        eventCardUid: destroyedXyz.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === hope.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === hope.uid), restoredTrigger.session.state)).toBe(6000);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ownNonXyz.uid), restoredTrigger.session.state)).toBe(1400);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === hope.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", property: 1024, reset: { flags: 33427456 }, value: 3000 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === destroyedXyz.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyedXyz.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: hopeCode, name: "Number 38: Hope Harbinger Dragon Titanic Galaxy", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 8, attack: 3000, defense: 2500 },
    { code: destroyedXyzCode, name: "Hope Harbinger Destroyed Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 4, attack: 3000, defense: 1000 },
    { code: ownNonXyzCode, name: "Hope Harbinger Non-Xyz Ally", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1400, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
