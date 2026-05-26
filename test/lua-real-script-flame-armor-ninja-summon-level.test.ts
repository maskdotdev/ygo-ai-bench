import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const flameArmorNinjaCode = "33034646";
const hasFlameArmorNinjaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${flameArmorNinjaCode}.lua`));
const ninjaTargetCode = "33034647";
const offSetDecoyCode = "33034648";
const responderCode = "33034649";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setNinja = 0x2b;
const effectUpdateLevel = 130;

describe.skipIf(!hasUpstreamScripts || !hasFlameArmorNinjaScript)("Lua real script Flame Armor Ninja summon Level trigger", () => {
  it("restores cloned summon-success target prompt into a Ninja EFFECT_UPDATE_LEVEL boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${flameArmorNinjaCode}.lua`);
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e2:SetCode(EVENT_FLIP_SUMMON_SUCCESS)");
    expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return c:IsFaceup() and c:GetLevel()~=0 and c:IsSetCard(SET_NINJA)");
    expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_LEVEL)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
    expect(script).toContain("e1:SetValue(1)");

    const cards: DuelCardData[] = [
      { code: flameArmorNinjaCode, name: "Flame Armor Ninja", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setNinja], level: 4, attack: 1700, defense: 1000 },
      { code: ninjaTargetCode, name: "Flame Armor Ninja Level Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setNinja], level: 3, attack: 1200, defense: 1200 },
      { code: offSetDecoyCode, name: "Flame Armor Ninja Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Flame Armor Ninja Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 33034646, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [flameArmorNinjaCode, ninjaTargetCode, offSetDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const flameArmorNinja = requireCard(session, flameArmorNinjaCode);
    const ninjaTarget = requireCard(session, ninjaTargetCode);
    const offSetDecoy = requireCard(session, offSetDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, flameArmorNinja.uid, "hand", 0);
    moveFaceUpAttack(session, ninjaTarget, 0);
    moveFaceUpAttack(session, offSetDecoy, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    expect(currentLevel(ninjaTarget, session.state)).toBe(3);
    expect(currentLevel(offSetDecoy, session.state)).toBe(3);

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(flameArmorNinjaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredSummonWindow);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === flameArmorNinja.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummonWindow, summon!);
    expect(restoredSummonWindow.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned")).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: flameArmorNinja.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
      },
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1100",
        sourceUid: flameArmorNinja.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "normalSummoned",
        eventCode: 1100,
        eventPlayer: 0,
        eventCardUid: flameArmorNinja.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === flameArmorNinja.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-1-1100",
        sourceUid: flameArmorNinja.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 2,
        targetFieldIds: [6],
        targetUids: [ninjaTarget.uid],
        eventName: "normalSummoned",
        eventCode: 1100,
        eventPlayer: 0,
        eventCardUid: flameArmorNinja.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
      },
    ]);
    expect(restoredTriggerWindow.session.state.chain[0]?.operationInfos).toBeUndefined();

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("flame armor ninja responder resolved");

    expect(currentLevel(restoredChain.session.state.cards.find((card) => card.uid === ninjaTarget.uid), restoredChain.session.state)).toBe(4);
    expect(currentLevel(restoredChain.session.state.cards.find((card) => card.uid === offSetDecoy.uid), restoredChain.session.state)).toBe(3);
    expect(restoredChain.session.state.effects.filter((effect) => effect.code === effectUpdateLevel).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      property: effect.property,
      sourceUid: effect.sourceUid,
      value: effect.value,
      reset: effect.reset,
    }))).toEqual([
      {
        code: effectUpdateLevel,
        controller: 0,
        event: "continuous",
        property: 1024,
        sourceUid: ninjaTarget.uid,
        value: 1,
        reset: { flags: 33427456 },
      },
    ]);

    const restoredAfterLevel = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredAfterLevel);
    expectRestoredLegalActions(restoredAfterLevel, 0);
    expect(currentLevel(restoredAfterLevel.session.state.cards.find((card) => card.uid === ninjaTarget.uid), restoredAfterLevel.session.state)).toBe(4);
    assertLuaLevel(restoredAfterLevel, ninjaTargetCode, 4);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
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
      e:SetOperation(function(e,tp) Debug.Message("flame armor ninja responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function assertLuaLevel(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: number): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("flame armor ninja level " .. tostring(target and target:GetLevel()))
    `,
    `flame-armor-ninja-level-${expected}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`flame armor ninja level ${expected}`);
}
