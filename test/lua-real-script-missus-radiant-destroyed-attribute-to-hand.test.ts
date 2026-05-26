import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
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
const attributeEarth = 0x1;
const attributeWind = 0x8;
const categoryToHand = 0x8;
const effectUpdateAttack = 100;
const eventDestroyed = 1029;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Missus Radiant destroyed Attribute to hand", () => {
  it("restores cloned EARTH/WIND stat effects and its delayed destroyed target return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const radiantCode = "3987233";
    const earthTargetCode = "3987234";
    const windDecoyCode = "3987235";
    const destroyerCode = "3987236";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === radiantCode),
      {
        code: earthTargetCode,
        name: "Missus Radiant EARTH Grave Target",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        level: 4,
        attack: 1000,
        defense: 1000,
        attribute: attributeEarth,
      },
      {
        code: windDecoyCode,
        name: "Missus Radiant WIND Grave Decoy",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        level: 4,
        attack: 1000,
        defense: 1000,
        attribute: attributeWind,
      },
      {
        code: destroyerCode,
        name: "Missus Radiant Effect Destroyer",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        level: 4,
        attack: 1800,
        defense: 1000,
        attribute: attributeWind,
      },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3987233, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [earthTargetCode, windDecoyCode], extra: [radiantCode] }, 1: { main: [destroyerCode] } });
    startDuel(session);

    const radiant = requireCard(session, radiantCode);
    const earthTarget = requireCard(session, earthTargetCode);
    const windDecoy = requireCard(session, windDecoyCode);
    const destroyer = requireCard(session, destroyerCode);
    moveDuelCard(session.state, radiant.uid, "monsterZone", 0).position = "faceUpAttack";
    radiant.faceUp = true;
    radiant.summonType = "link";
    moveDuelCard(session.state, earthTarget.uid, "graveyard", 0);
    moveDuelCard(session.state, windDecoy.uid, "graveyard", 0);
    moveDuelCard(session.state, destroyer.uid, "monsterZone", 1).position = "faceUpAttack";
    destroyer.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${destroyerCode}.lua`) return destroyerScript(radiantCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(radiantCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(destroyerCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === radiant.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      id: effect.id,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      {
        code: effectUpdateAttack,
        controller: 0,
        event: "continuous",
        id: "lua-2-100",
        luaTargetDescriptor: "target:attribute:1",
        range: ["monsterZone"],
        sourceUid: radiant.uid,
        targetRange: [4, 4],
        value: 500,
      },
      {
        code: effectUpdateAttack,
        controller: 0,
        event: "continuous",
        id: "lua-4-100",
        luaTargetDescriptor: "target:attribute:8",
        range: ["monsterZone"],
        sourceUid: radiant.uid,
        targetRange: [4, 4],
        value: -400,
      },
    ]);
    expect(restoredOpen.session.state.effects.find((effect) => effect.sourceUid === radiant.uid && effect.code === eventDestroyed)).toMatchObject({
      category: categoryToHand,
      code: eventDestroyed,
      controller: 0,
      countLimit: 1,
      countLimitCode: Number(radiantCode),
      description: 63795728,
      event: "trigger",
      id: "lua-6-1029",
      luaTypeFlags: 129,
      optional: true,
      property: 65552,
      registryKey: "lua:3987233:lua-6-1029",
      sourceUid: radiant.uid,
      triggerCode: eventDestroyed,
      triggerEvent: "destroyed",
      triggerSourceOnly: true,
      triggerTiming: "if",
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === radiant.uid)!, restoredOpen.session.state)).toBe((radiant.data.attack ?? 0) + 500);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === destroyer.uid)!, restoredOpen.session.state)).toBe((destroyer.data.attack ?? 0) - 400);

    const destroy = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, destroy!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    const restoredDestroyChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredDestroyChain);
    expectRestoredLegalActions(restoredDestroyChain, 0);
    passRestoredChainUntilResolved(restoredDestroyChain);

    expect(restoredDestroyChain.session.state.cards.find((card) => card.uid === radiant.uid)).toMatchObject({
      controller: 0,
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: destroyer.uid,
    });
    expect(restoredDestroyChain.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        player: 0,
        effectId: "lua-6-1029",
        sourceUid: radiant.uid,
        triggerBucket: "opponentOptional",
        eventName: "destroyed",
        eventCode: eventDestroyed,
        eventPlayer: 0,
        eventCardUid: radiant.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 7,
        eventTriggerTiming: "if",
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 2,
        },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyChain.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(getLuaRestoreLegalActions(restoredTrigger, 1)).toEqual([]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === radiant.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);

    const restoredToHandChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredToHandChain);
    expectRestoredLegalActions(restoredToHandChain, 1);
    passRestoredChainUntilResolved(restoredToHandChain);

    expect(restoredToHandChain.session.state.cards.find((card) => card.uid === earthTarget.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredToHandChain.session.state.cards.find((card) => card.uid === windDecoy.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredToHandChain.session.state.eventHistory.filter((event) => event.eventName === "sentToHand" && event.eventCardUid === earthTarget.uid)).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: earthTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: radiant.uid,
        eventReasonEffectId: 6,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
  });
});

function destroyerScript(radiantCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(s.destg)
      e:SetOperation(s.desop)
      c:RegisterEffect(e)
    end
    function s.desfilter(c)
      return c:IsCode(${radiantCode})
    end
    function s.destg(e,tp,eg,ep,ev,re,r,rp,chk)
      local g=Duel.GetMatchingGroup(s.desfilter,tp,0,LOCATION_MZONE,nil)
      if chk==0 then return #g>0 end
      Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)
    end
    function s.desop(e,tp,eg,ep,ev,re,r,rp)
      local g=Duel.GetMatchingGroup(s.desfilter,tp,0,LOCATION_MZONE,nil)
      if #g>0 then
        Duel.Destroy(g,REASON_EFFECT)
      end
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
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

function passRestoredChainUntilResolved(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain")
      ?? getLuaRestoreLegalActions(restored, player === 0 ? 1 : 0).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify({
      waitingFor: restored.session.state.waitingFor,
      player,
      playerActions: getLuaRestoreLegalActions(restored, player),
      opponentActions: getLuaRestoreLegalActions(restored, player === 0 ? 1 : 0),
    }, null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
    const nextPlayer = restored.session.state.waitingFor;
    if (nextPlayer !== undefined) {
      expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, nextPlayer));
      expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, nextPlayer));
      expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    }
  }
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
