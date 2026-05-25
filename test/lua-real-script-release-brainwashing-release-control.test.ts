import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const brainwashingCode = "85395151";
const releaseStarterCode = "853951510";
const releaseCostCode = "853951511";
const ownedTargetCode = "853951512";
const opponentTargetCode = "853951513";
const responderCode = "853951514";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBrainwashingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${brainwashingCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const categoryToHand = 0x8;
const categoryControl = 0x2000;
const categoryDisable = 0x4000;
const effectFlagDelay = 0x10000;
const effectFlagCardTarget = 0x10;
const phaseEndEventCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasBrainwashingScript)("Lua real script Release Brainwashing release control", () => {
  it("restores EVENT_RELEASE trap activation that regains an owned monster and delays its End Phase return", () => {
    const { reader, session, source, workspace } = createReleaseBrainwashingSession("owned");
    const script = workspace.readScript(`official/c${brainwashingCode}.lua`);
    expectScriptShape(script);
    const brainwashing = requireCard(session, brainwashingCode);
    const starter = requireCard(session, releaseStarterCode);
    const releaseCost = requireCard(session, releaseCostCode);
    const ownedTarget = requireCard(session, ownedTargetCode);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === brainwashing.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryControl | categoryToHand | categoryDisable, code: 1017, countLimit: 1, event: "quick", property: effectFlagDelay | effectFlagCardTarget, range: ["spellTrapZone"], triggerEvent: "released" },
    ]);

    releaseCostAndPassChain(restoredOpen, starter.uid);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === releaseCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: starter.uid,
      reasonEffectId: 2,
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateEffect" && action.uid === brainwashing.uid && action.effectId === "lua-1-1017"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toHaveLength(1);
    expect(restoredTrigger.session.state.chain.map((link) => ({
      activationLocation: link.activationLocation,
      effectId: link.effectId,
      eventName: link.eventName,
      operationInfos: link.operationInfos,
      player: link.player,
      sourceUid: link.sourceUid,
      targetUids: link.targetUids,
    }))).toEqual([{
      activationLocation: "spellTrapZone",
      effectId: "lua-1-1017",
      eventName: "released",
      operationInfos: [{ category: categoryControl, targetUids: [ownedTarget.uid], count: 1, player: 0, parameter: 0 }],
      player: 0,
      sourceUid: brainwashing.uid,
      targetUids: [ownedTarget.uid],
    }]);
    expect(restoredTrigger.session.state.chain[0]!.possibleOperationInfos).toEqual([
      { category: categoryToHand, targetUids: [ownedTarget.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    passRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === ownedTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: brainwashing.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.effects.find((effect) =>
      effect.event === "continuous" && effect.code === phaseEndEventCode && effect.sourceUid === brainwashing.uid
    )).toMatchObject({
      labelObjectUids: [ownedTarget.uid],
      reset: { flags: 0, count: 0 },
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["released", "becameTarget", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "released", eventCardUid: releaseCost.uid, eventReason: duelReason.effect | duelReason.release, eventReasonCardUid: starter.uid, eventReasonEffectId: 2, previous: "monsterZone", current: "graveyard", previousController: 0, currentController: 0 },
      { eventName: "becameTarget", eventCardUid: ownedTarget.uid, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone", previousController: 0, currentController: 1 },
      { eventName: "controlChanged", eventCardUid: ownedTarget.uid, eventReason: duelReason.effect, eventReasonCardUid: brainwashing.uid, eventReasonEffectId: 1, previous: "monsterZone", current: "monsterZone", previousController: 1, currentController: 0 },
    ]);
  });

  it("restores EVENT_RELEASE trap activation that negates an opponent-owned monster", () => {
    const { reader, session, source } = createReleaseBrainwashingSession("opponent");
    const brainwashing = requireCard(session, brainwashingCode);
    const starter = requireCard(session, releaseStarterCode);
    const opponentTarget = requireCard(session, opponentTargetCode);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    releaseCostAndPassChain(restoredOpen, starter.uid);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateEffect" && action.uid === brainwashing.uid && action.effectId === "lua-1-1017"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.map((link) => ({
      operationInfos: link.operationInfos,
      targetUids: link.targetUids,
    }))).toEqual([{
      operationInfos: [{ category: categoryDisable, targetUids: [opponentTarget.uid], count: 1, player: 0, parameter: 0 }],
      targetUids: [opponentTarget.uid],
    }]);
    expect(restoredTrigger.session.state.chain[0]!.possibleOperationInfos ?? []).toEqual([]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    passRestoredChain(restoredChain);
    const disabledTarget = restoredChain.session.state.cards.find((card) => card.uid === opponentTarget.uid)!;
    expect(disabledTarget).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(isCardDisabled(restoredChain.session.state, disabledTarget, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredChain.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === opponentTarget.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 2, event: "continuous", reset: { flags: 1107169792, count: 1 }, value: undefined },
      { code: 8, event: "continuous", reset: { flags: 1107169792, count: 1 }, value: 131072 },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["becameTarget", "controlChanged"].includes(event.eventName)).map((event) => event.eventName)).toEqual(["becameTarget"]);
  });
});

function createReleaseBrainwashingSession(branch: "opponent" | "owned"): {
  reader: ReturnType<typeof createCardReader>;
  session: DuelSession;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
} {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const reader = createCardReader(cards());
  const source = {
    readScript(name: string) {
      if (name === `c${releaseStarterCode}.lua`) return releaseStarterScript(releaseCostCode);
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      return workspace.readScript(name);
    },
  };
  const main0 = branch === "owned" ? [brainwashingCode, releaseStarterCode, releaseCostCode, ownedTargetCode] : [brainwashingCode, releaseStarterCode, releaseCostCode];
  const main1 = [opponentTargetCode, responderCode];
  const session = createDuel({ seed: branch === "owned" ? 85395151 : 85395152, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: main0 }, 1: { main: main1 } });
  startDuel(session);

  const brainwashing = requireCard(session, brainwashingCode);
  const starter = requireCard(session, releaseStarterCode);
  const releaseCost = requireCard(session, releaseCostCode);
  moveDuelCard(session.state, brainwashing.uid, "spellTrapZone", 0);
  brainwashing.faceUp = false;
  moveDuelCard(session.state, starter.uid, "hand", 0);
  moveFaceUpAttack(session, releaseCost, 0, 0);
  if (branch === "owned") {
    const ownedTarget = requireCard(session, ownedTargetCode);
    moveFaceUpAttack(session, ownedTarget, 1, 0);
    ownedTarget.owner = 0;
  } else {
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveFaceUpAttack(session, opponentTarget, 1, 0);
  }
  moveDuelCard(session.state, requireCard(session, responderCode).uid, "hand", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(brainwashingCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(releaseStarterCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(3);
  return { reader, session, source, workspace };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Release Brainwashing");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL+CATEGORY_TOHAND+CATEGORY_DISABLE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCode(EVENT_RELEASE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,tc,1,tp,0)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,tc,1,tp,0)");
  expect(script).toContain("Duel.GetControl(tc,tp)");
  expect(script).toContain("aux.DelayedOperation(tc,PHASE_END,id,e,tp,function(ag) Duel.SendtoHand(ag,nil,REASON_EFFECT) end");
  expect(script).toContain("tc:NegateEffects(e:GetHandler(),RESET_PHASE|PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: brainwashingCode, name: "Release Brainwashing", kind: "trap", typeFlags: typeTrap },
    { code: releaseStarterCode, name: "Release Brainwashing Release Starter", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: releaseCostCode, name: "Release Brainwashing Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: ownedTargetCode, name: "Release Brainwashing Owned Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
    { code: opponentTargetCode, name: "Release Brainwashing Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1900, defense: 1000 },
    { code: responderCode, name: "Release Brainwashing Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("release brainwashing responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function releaseStarterScript(releaseCostCodeValue: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        local g=Duel.SelectMatchingCard(tp,Card.IsCode,tp,LOCATION_MZONE,0,1,1,nil,${releaseCostCodeValue})
        Duel.Release(g,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function releaseCostAndPassChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, starterUid: string): void {
  const starterAction = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === starterUid);
  expect(starterAction, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, starterAction!);
  passRestoredChain(restored);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
