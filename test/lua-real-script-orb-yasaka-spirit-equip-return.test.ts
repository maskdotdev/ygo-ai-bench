import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Orb of Yasaka Spirit equip return", () => {
  it("restores its Spirit-only equip recovery and lost-target return trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const orbCode = "74115234";
    const susaCode = "40473581";
    const defenderCode = "74115235";
    const responderCode = "74115236";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === orbCode || card.code === susaCode),
      { code: defenderCode, name: "Orb of Yasaka Battle Victim", kind: "monster", typeFlags: typeMonster, level: 4, attack: 500, defense: 500 },
      { code: responderCode, name: "Orb of Yasaka Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 741, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [orbCode, susaCode] }, 1: { main: [defenderCode, responderCode] } });
    startDuel(session);

    const orb = session.state.cards.find((card) => card.code === orbCode);
    const susa = session.state.cards.find((card) => card.code === susaCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(orb).toBeDefined();
    expect(susa).toBeDefined();
    expect(defender).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, orb!.uid, "hand", 0);
    moveDuelCard(session.state, susa!.uid, "hand", 0);
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1);
    defender!.faceUp = true;
    defender!.position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(orbCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(susaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(session.state.effects.find((effect) => effect.sourceUid === responder!.uid)).toMatchObject({
      hintTiming: [0x1000020],
      property: 0xc000,
      range: ["hand"],
    });

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.session.state.effects.find((effect) => effect.sourceUid === responder!.uid)).toMatchObject({
      hintTiming: [0x1000020],
      property: 0xc000,
      range: ["hand"],
    });
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === susa!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);
    expect(restoredSummonWindow.session.state.cards.find((card) => card.uid === susa!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "normal",
      faceUp: true,
    });

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipWindow.missingRegistryKeys).toEqual([]);
    expect(restoredEquipWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipWindow, 0);
    const equip = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === orb!.uid);
    expect(equip, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEquipWindow, equip!);
    expect(restoredEquipWindow.session.state.chain[0]).toMatchObject({
      sourceUid: orb!.uid,
      targetUids: [susa!.uid],
      operationInfos: [{ category: 0x40000, targetUids: [orb!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restoredEquipChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expect(restoredEquipChain.restoreComplete, restoredEquipChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipChain.missingRegistryKeys).toEqual([]);
    expect(restoredEquipChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipChain, 1);
    expect(getLuaRestoreLegalActions(restoredEquipChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredEquipChain);
    expect(restoredEquipChain.host.messages).not.toContain("orb responder resolved");
    expect(restoredEquipChain.session.state.cards.find((card) => card.uid === orb!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: susa!.uid,
      faceUp: true,
    });

    const restoredEquippedState = restoreDuelWithLuaScripts(serializeDuel(restoredEquipChain.session), source, reader);
    expect(restoredEquippedState.restoreComplete, restoredEquippedState.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquippedState.missingRegistryKeys).toEqual([]);
    expect(restoredEquippedState.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquippedState, 0);
    expect(restoredEquippedState.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: orb!.uid, event: "continuous", code: 76 }),
        expect.objectContaining({ sourceUid: orb!.uid, event: "trigger", triggerCode: 1139 }),
      ]),
    );
    expectLuaEquipProbe(restoredEquippedState, orbCode, susaCode, "orb equip probe true/40473581");
    changeRestoredPhase(restoredEquippedState, 0, "battle");

    const restoredBattleWindow = restoreDuelWithLuaScripts(serializeDuel(restoredEquippedState.session), source, reader);
    expect(restoredBattleWindow.restoreComplete, restoredBattleWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattleWindow.missingRegistryKeys).toEqual([]);
    expect(restoredBattleWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredBattleWindow, 0);
    const attack = getLuaRestoreLegalActions(restoredBattleWindow, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === susa!.uid && action.targetUid === defender!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattleWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleWindow, attack!);
    passBattleUntilTrigger(restoredBattleWindow);

    expect(restoredBattleWindow.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredBattleWindow.session.state.players[1].lifePoints).toBe(7250);
    expect(restoredBattleWindow.session.state.cards.find((card) => card.uid === defender!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBattleWindow.session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: orb!.uid, eventName: "battleDestroyed", eventCode: 1140, player: 0 }),
      ]),
    );

    const restoredRecoverTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattleWindow.session), source, reader);
    expect(restoredRecoverTrigger.restoreComplete, restoredRecoverTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredRecoverTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredRecoverTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredRecoverTrigger, 0);
    const recoverTrigger = getLuaRestoreLegalActions(restoredRecoverTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === orb!.uid);
    expect(recoverTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredRecoverTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRecoverTrigger, recoverTrigger!);
    expect(restoredRecoverTrigger.session.state.chain[0]).toMatchObject({
      sourceUid: orb!.uid,
      eventName: "battleDestroyed",
      eventCode: 1140,
      targetPlayer: 0,
      targetParam: 500,
      operationInfos: [{ category: 0x100000, targetUids: [], count: 0, player: 0, parameter: 500 }],
    });

    const restoredRecoverChain = restoreDuelWithLuaScripts(serializeDuel(restoredRecoverTrigger.session), source, reader);
    expect(restoredRecoverChain.restoreComplete, restoredRecoverChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredRecoverChain.missingRegistryKeys).toEqual([]);
    expect(restoredRecoverChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredRecoverChain, 1);
    resolveRestoredChain(restoredRecoverChain);
    expect(restoredRecoverChain.session.state.players[0].lifePoints).toBe(8500);
    expect(restoredRecoverChain.session.state.players[1].lifePoints).toBe(7250);
    expect(restoredRecoverChain.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "battleDamageDealt", eventCode: 1143, eventPlayer: 1, eventValue: 750, eventCardUid: susa!.uid }),
      ]),
    );
    expect(restoredRecoverChain.session.state.eventHistory.filter((event) => event.eventName === "recoveredLifePoints" && event.eventPlayer === 0)).toEqual([
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: orb!.uid,
        eventReasonEffectId: 3,
      },
    ]);
    passBattleUntilComplete(restoredRecoverChain);

    const restoredEndPhasePath = restoreDuelWithLuaScripts(serializeDuel(restoredRecoverChain.session), source, reader);
    expect(restoredEndPhasePath.restoreComplete, restoredEndPhasePath.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEndPhasePath.missingRegistryKeys).toEqual([]);
    expect(restoredEndPhasePath.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEndPhasePath, 0);
    changeRestoredPhase(restoredEndPhasePath, 0, "main2");
    changeRestoredPhase(restoredEndPhasePath, 0, "end");
    expect(restoredEndPhasePath.session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: susa!.uid, eventName: "phaseEnd", eventCode: 0x1200, player: 0 }),
      ]),
    );

    const restoredSpiritReturn = restoreDuelWithLuaScripts(serializeDuel(restoredEndPhasePath.session), source, reader);
    expect(restoredSpiritReturn.restoreComplete, restoredSpiritReturn.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSpiritReturn.missingRegistryKeys).toEqual([]);
    expect(restoredSpiritReturn.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSpiritReturn, 0);
    const spiritReturn = getLuaRestoreLegalActions(restoredSpiritReturn, 0).find((action) => action.type === "activateTrigger" && action.uid === susa!.uid);
    expect(spiritReturn, JSON.stringify(getLuaRestoreLegalActions(restoredSpiritReturn, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSpiritReturn, spiritReturn!);
    expect(restoredSpiritReturn.session.state.chain[0]).toMatchObject({
      sourceUid: susa!.uid,
      operationInfos: [{ category: 0x8, targetUids: [susa!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restoredSpiritReturnChain = restoreDuelWithLuaScripts(serializeDuel(restoredSpiritReturn.session), source, reader);
    expect(restoredSpiritReturnChain.restoreComplete, restoredSpiritReturnChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSpiritReturnChain.missingRegistryKeys).toEqual([]);
    expect(restoredSpiritReturnChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSpiritReturnChain, 1);
    resolveRestoredChain(restoredSpiritReturnChain);
    expect(restoredSpiritReturnChain.session.state.cards.find((card) => card.uid === susa!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredSpiritReturnChain.session.state.cards.find((card) => card.uid === orb!.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: susa!.uid,
      reason: duelReason.lostTarget,
    });
    expect(restoredSpiritReturnChain.session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: orb!.uid, eventName: "sentToGraveyard", eventCode: 1014, player: 0 }),
      ]),
    );

    const restoredOrbReturn = restoreDuelWithLuaScripts(serializeDuel(restoredSpiritReturnChain.session), source, reader);
    expect(restoredOrbReturn.restoreComplete, restoredOrbReturn.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOrbReturn.missingRegistryKeys).toEqual([]);
    expect(restoredOrbReturn.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredOrbReturn, 0);
    const orbReturn = getLuaRestoreLegalActions(restoredOrbReturn, 0).find((action) => action.type === "activateTrigger" && action.uid === orb!.uid);
    expect(orbReturn, JSON.stringify(getLuaRestoreLegalActions(restoredOrbReturn, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOrbReturn, orbReturn!);
    expect(restoredOrbReturn.session.state.chain[0]).toMatchObject({
      sourceUid: orb!.uid,
      operationInfos: [{ category: 0x8, targetUids: [orb!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restoredOrbReturnChain = restoreDuelWithLuaScripts(serializeDuel(restoredOrbReturn.session), source, reader);
    expect(restoredOrbReturnChain.restoreComplete, restoredOrbReturnChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOrbReturnChain.missingRegistryKeys).toEqual([]);
    expect(restoredOrbReturnChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredOrbReturnChain, 1);
    resolveRestoredChain(restoredOrbReturnChain);
    expect(restoredOrbReturnChain.session.state.cards.find((card) => card.uid === orb!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredOrbReturnChain.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "confirmed", eventCardUid: orb!.uid }),
      ]),
    );
    expect(restoredOrbReturnChain.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === orb!.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: orb!.uid,
        eventReason: duelReason.lostTarget,
        eventReasonPlayer: 0,
        eventReasonCardUid: orb!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredOrbReturnChain.session.state.eventHistory.filter((event) => event.eventName === "sentToHand")).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: susa!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: susa!.uid,
        eventReasonEffectId: 5,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: orb!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: orb!.uid,
        eventReasonEffectId: 4,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
    expect(restoredOrbReturnChain.host.messages).not.toContain("orb responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)
      e:SetHintTiming(TIMING_BATTLE_PHASE+TIMING_END_PHASE)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("orb responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectLuaEquipProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, orbCode: string, targetCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local orb=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${orbCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local target=orb and orb:GetEquipTarget()
      Debug.Message("orb equip probe " .. tostring(orb and orb:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil) .. "/" .. tostring(target and target:GetCode()))
    `,
    "orb-yasaka-equip-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function changeRestoredPhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, phase: "battle" | "main2" | "end"): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
}

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passBattleUntilComplete(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
