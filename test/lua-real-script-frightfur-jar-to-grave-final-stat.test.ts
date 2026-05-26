import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentCardMatchesCode } from "#duel/card-code-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const frightfurJarCode = "18138630";
const toyVendorCode = "70245411";
const targetCode = "181386301";
const facedownDecoyCode = "181386302";
const ownDecoyCode = "181386303";
const destroyerCode = "181386304";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Frightfur Jar to-Grave final stat", () => {
  it("restores Toy Vendor code change and delayed EVENT_TO_GRAVE target final ATK halving", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${frightfurJarCode}.lua`);
    expect(script).toContain("e2:SetCode(EFFECT_CHANGE_CODE)");
    expect(script).toContain("e2:SetRange(LOCATION_SZONE|LOCATION_GRAVE)");
    expect(script).toContain("e2:SetValue(70245411)");
    expect(script).toContain("e4:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("e4:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(tc:GetAttack()/2)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === frightfurJarCode),
      { code: targetCode, name: "Frightfur Jar Face-up Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 1000 },
      { code: facedownDecoyCode, name: "Frightfur Jar Facedown Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 3000, defense: 1000 },
      { code: ownDecoyCode, name: "Frightfur Jar Own Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2600, defense: 1000 },
      { code: destroyerCode, name: "Frightfur Jar Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 18138630, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [frightfurJarCode, ownDecoyCode, destroyerCode] }, 1: { main: [targetCode, facedownDecoyCode] } });
    startDuel(session);

    const frightfurJar = requireCard(session, frightfurJarCode);
    const target = requireCard(session, targetCode);
    const facedownDecoy = requireCard(session, facedownDecoyCode);
    const ownDecoy = requireCard(session, ownDecoyCode);
    const destroyer = requireCard(session, destroyerCode);
    moveDuelCard(session.state, frightfurJar.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, destroyer.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, ownDecoy.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target.uid, "monsterZone", 1).position = "faceUpAttack";
    const movedFacedownDecoy = moveDuelCard(session.state, facedownDecoy.uid, "monsterZone", 1);
    movedFacedownDecoy.faceUp = false;
    movedFacedownDecoy.position = "faceDownDefense";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${destroyerCode}.lua`) return destroyerScript(toyVendorCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [frightfurJarCode, destroyerCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(2);
    expect(currentCardMatchesCode(frightfurJar, session.state, toyVendorCode)).toBe(true);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(currentCardMatchesCode(restoredOpen.session.state.cards.find((card) => card.uid === frightfurJar.uid)!, restoredOpen.session.state, toyVendorCode)).toBe(true);

    const destroy = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, destroy!);
    resolveRestoredChain(restoredOpen);
    const destroyedJar = restoredOpen.session.state.cards.find((card) => card.uid === frightfurJar.uid);
    expect({
      controller: destroyedJar?.controller,
      faceUp: destroyedJar?.faceUp,
      location: destroyedJar?.location,
      position: destroyedJar?.position,
      previousCodes: destroyedJar?.previousCodes,
      previousFaceUp: destroyedJar?.previousFaceUp,
      previousLocation: destroyedJar?.previousLocation,
      previousSequence: destroyedJar?.previousSequence,
      reason: destroyedJar?.reason,
      reasonCardUid: destroyedJar?.reasonCardUid,
      reasonEffectId: destroyedJar?.reasonEffectId,
      reasonPlayer: destroyedJar?.reasonPlayer,
      sequence: destroyedJar?.sequence,
      uid: destroyedJar?.uid,
    }).toEqual({
      controller: 0,
      faceUp: true,
      location: "graveyard",
      position: "faceDown",
      previousCodes: [toyVendorCode],
      previousFaceUp: true,
      previousLocation: "spellTrapZone",
      previousSequence: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: destroyer.uid,
      reasonEffectId: 5,
      reasonPlayer: 0,
      sequence: 0,
      uid: frightfurJar.uid,
    });
    expect(currentCardMatchesCode(restoredOpen.session.state.cards.find((card) => card.uid === frightfurJar.uid)!, restoredOpen.session.state, toyVendorCode)).toBe(true);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        player: 0,
        effectId: "lua-4-1014",
        sourceUid: frightfurJar.uid,
        triggerBucket: "turnOptional",
        eventName: "sentToGraveyard",
        eventPlayer: 0,
        eventCode: 1014,
        eventCardUid: frightfurJar.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 5,
        eventTriggerTiming: "if",
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === frightfurJar.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect({
      type: trigger?.type,
      uid: "uid" in trigger! ? trigger!.uid : undefined,
      player: "player" in trigger! ? trigger!.player : undefined,
      targetUids: "targetUids" in trigger! ? trigger!.targetUids : undefined,
      operationInfos: "operationInfos" in trigger! ? trigger!.operationInfos : undefined,
    }).toEqual({
      type: "activateTrigger",
      uid: frightfurJar.uid,
      player: 0,
      targetUids: undefined,
      operationInfos: undefined,
    });
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.host.promptDecisions).toEqual([]);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid), restoredTrigger.session.state)).toBe(1200);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === facedownDecoy.uid), restoredTrigger.session.state)).toBe(3000);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ownDecoy.uid), restoredTrigger.session.state)).toBe(2600);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.code === 102 && effect.registryKey === "lua:18138630:lua-6-102").map((effect) => ({
      code: effect.code,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: 102, registryKey: "lua:18138630:lua-6-102", reset: { flags: 1107169792 }, sourceUid: target.uid, value: 1200 }]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: target.uid,
        eventChainDepth: 1,
        eventChainLinkId: "chain-5",
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 4,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === ownDecoy.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    finishBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 1400 });
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: ownDecoy.uid,
        eventPlayer: 1,
        eventValue: 1400,
        eventReason: duelReason.battle,
        eventReasonCardUid: ownDecoy.uid,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 2,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function destroyerScript(targetCodeToDestroy: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCodeToDestroy}),tp,LOCATION_SZONE,0,nil)
        if tc then Duel.Destroy(tc,REASON_EFFECT) end
      end)
      c:RegisterEffect(e)
    end
  `;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyLuaRestoreAndAssert(restored, trigger);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
