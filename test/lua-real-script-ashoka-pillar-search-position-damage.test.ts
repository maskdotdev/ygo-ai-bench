import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts, type LuaSnapshotRestoreResult } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const ashokaCode = "58996839";
const equipCode = "58996840";
const decoySpellCode = "58996841";
const responderCode = "58996842";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeEquip = 0x40000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ashoka Pillar search position and damage", () => {
  it("restores its summon search, possible position operation, and destroyed self-damage trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${ashokaCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SEARCH+CATEGORY_TOHAND+CATEGORY_POSITION)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("local e3=e2:Clone()");
    expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return c:IsEquipSpell() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_POSITION,e:GetHandler(),1,0,0)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.ChangePosition(c,POS_FACEUP_DEFENSE)");
    expect(script).toContain("e4:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.SetTargetParam(2000)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ashokaCode),
      { code: equipCode, name: "Ashoka Pillar Equip Spell Target", kind: "spell", typeFlags: typeSpell | typeEquip },
      { code: decoySpellCode, name: "Ashoka Pillar Normal Spell Decoy", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Ashoka Pillar Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 58996839, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ashokaCode, equipCode, decoySpellCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const ashoka = requireCard(session, ashokaCode);
    const equip = requireCard(session, equipCode);
    const decoySpell = requireCard(session, decoySpellCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, ashoka.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ashokaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const normalSummon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === ashoka.uid);
    expect(normalSummon, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, normalSummon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toHaveLength(1);
    const pendingSearch = restoredTriggerWindow.session.state.pendingTriggers[0]!;
    expect(pendingSearch).toEqual({
      id: "trigger-3-1",
      effectId: pendingSearch.effectId,
      sourceUid: ashoka.uid,
      player: 0,
      triggerBucket: "turnOptional",
      eventName: "normalSummoned",
      eventCode: 1100,
      eventCardUid: ashoka.uid,
      eventReason: duelReason.summon,
      eventReasonPlayer: 0,
      eventTriggerTiming: "if",
      eventPreviousState: {
        controller: 0,
        faceUp: false,
        location: "hand",
        position: "faceDown",
        sequence: 0,
      },
      eventCurrentState: {
        controller: 0,
        faceUp: true,
        location: "monsterZone",
        position: "faceUpAttack",
        sequence: 0,
      },
    });

    const searchTrigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === ashoka.uid);
    expect(searchTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, searchTrigger!);
    expect(restoredTriggerWindow.session.state.chain).toEqual([
      {
        activationLocation: "monsterZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: pendingSearch.effectId,
        eventCardUid: ashoka.uid,
        eventCode: 1100,
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventName: "normalSummoned",
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        id: "chain-3",
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 }],
        player: 0,
        possibleOperationInfos: [{ category: 0x1000, targetUids: [ashoka.uid], count: 1, player: 0, parameter: 0 }],
        sourceUid: ashoka.uid,
      },
    ]);

    const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredSearchChain);
    expectRestoredLegalActions(restoredSearchChain, 1);
    expect(getLuaRestoreLegalActions(restoredSearchChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const searchPass = getLuaRestoreLegalActions(restoredSearchChain, 1).find((action) => action.type === "passChain");
    expect(searchPass).toBeDefined();
    applyRestoredActionAndAssert(restoredSearchChain, searchPass!);

    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === equip.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === decoySpell.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === ashoka.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpDefense",
      faceUp: true,
    });
    expect(restoredSearchChain.session.state.eventHistory.filter((event) => event.eventName === "breakEffect")).toEqual([
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ashoka.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restoredSearchChain.session.state.eventHistory.some((event) => event.eventName === "sentToHand" && event.eventCardUid === equip.uid)).toBe(true);
    expect(restoredSearchChain.host.messages).toEqual([`confirmed 1: ${equipCode}`]);
    expect(restoredSearchChain.host.messages).not.toContain("ashoka responder resolved");

    const destroyedAshoka = destroyDuelCard(
      restoredSearchChain.session.state,
      ashoka.uid,
      0,
      duelReason.effect | duelReason.destroy,
      0,
      "graveyard",
      { eventReasonCardUid: equip.uid, eventReasonEffectId: 77 },
    );
    expect(destroyedAshoka).toMatchObject({ location: "graveyard", reason: duelReason.effect | duelReason.destroy });
    expect(restoredSearchChain.session.state.pendingTriggers).toHaveLength(1);

    const restoredDamageTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSearchChain.session), source, reader);
    expectCleanRestore(restoredDamageTrigger);
    expectRestoredLegalActions(restoredDamageTrigger, 0);
    const damageTrigger = getLuaRestoreLegalActions(restoredDamageTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === ashoka.uid);
    expect(damageTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDamageTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamageTrigger, damageTrigger!);
    expect(restoredDamageTrigger.session.state.chain).toEqual([
      {
        activationLocation: "graveyard",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-4-1029",
        eventCardUid: ashoka.uid,
        eventCode: 1029,
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpDefense",
          sequence: 0,
        },
        eventName: "destroyed",
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 0,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonCardUid: equip.uid,
        eventReasonEffectId: 77,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        id: "chain-8",
        operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 0, parameter: 2000 }],
        player: 0,
        sourceUid: ashoka.uid,
        targetParam: 2000,
        targetPlayer: 0,
      },
    ]);

    const restoredDamageChain = restoreDuelWithLuaScripts(serializeDuel(restoredDamageTrigger.session), source, reader);
    expectCleanRestore(restoredDamageChain);
    expectRestoredLegalActions(restoredDamageChain, 1);
    const damagePass = getLuaRestoreLegalActions(restoredDamageChain, 1).find((action) => action.type === "passChain");
    expect(damagePass).toBeDefined();
    applyRestoredActionAndAssert(restoredDamageChain, damagePass!);

    expect(restoredDamageChain.session.state.players[0].lifePoints).toBe(6000);
    expect(restoredDamageChain.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredDamageChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 2000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ashoka.uid,
        eventReasonEffectId: 4,
      },
    ]);
    expect(restoredDamageChain.host.messages).not.toContain("ashoka responder resolved");
  });
});

function expectCleanRestore(restored: LuaSnapshotRestoreResult): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: LuaSnapshotRestoreResult, player: PlayerId): void {
  const groups = getLuaRestoreLegalActionGroups(restored, player);
  const actions = getLuaRestoreLegalActions(restored, player);
  expect(actions).toEqual(getLegalActions(restored.session, player));
  expect(groups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(groups.flatMap((group) => group.actions)).toEqual(actions);
}

function applyRestoredActionAndAssert(restored: LuaSnapshotRestoreResult, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
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
      e:SetOperation(function(e,tp) Debug.Message("ashoka responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
