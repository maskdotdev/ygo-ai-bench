import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Driving Snow to-Grave target destroy", () => {
  it("restores opponent-destroyed Trap EVENT_TO_GRAVE trigger and targeted S/T destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const drivingSnowCode = "473469";
    const destroyedTrapCode = "4734690";
    const destroyerCode = "4734691";
    const targetSpellCode = "4734692";
    const monsterDecoyCode = "4734693";
    const responderCode = "4734694";
    const script = workspace.readScript(`c${drivingSnowCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("return rp~=tp and eg:IsExists(s.filter,1,nil,tp)");
    expect(script).toContain("c:IsTrap() and c:IsPreviousLocation(LOCATION_ONFIELD) and c:IsPreviousControler(tp)");
    expect(script).toContain("(c:GetReason()&(REASON_DESTROY|REASON_EFFECT))==(REASON_DESTROY|REASON_EFFECT)");
    expect(script).toContain("Duel.SelectTarget(tp,s.desfilter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,e:GetHandler())");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === drivingSnowCode),
      { code: destroyedTrapCode, name: "Driving Snow Destroyed Trap", kind: "trap", typeFlags: typeTrap },
      { code: destroyerCode, name: "Driving Snow Opponent Destroyer", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000 },
      { code: targetSpellCode, name: "Driving Snow Target Spell", kind: "spell", typeFlags: typeSpell },
      { code: monsterDecoyCode, name: "Driving Snow Monster Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1000 },
      { code: responderCode, name: "Driving Snow Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 473469, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [drivingSnowCode, destroyedTrapCode, monsterDecoyCode, responderCode] },
      1: { main: [destroyerCode, targetSpellCode] },
    });
    startDuel(session);

    const drivingSnow = requireCard(session, drivingSnowCode);
    const destroyedTrap = requireCard(session, destroyedTrapCode);
    const destroyer = requireCard(session, destroyerCode);
    const targetSpell = requireCard(session, targetSpellCode);
    const monsterDecoy = requireCard(session, monsterDecoyCode);
    const responder = requireCard(session, responderCode);
    const movedDrivingSnow = moveDuelCard(session.state, drivingSnow.uid, "spellTrapZone", 0);
    movedDrivingSnow.position = "faceDown";
    movedDrivingSnow.faceUp = false;
    movedDrivingSnow.turnId = 0;
    const movedDestroyedTrap = moveDuelCard(session.state, destroyedTrap.uid, "spellTrapZone", 0);
    movedDestroyedTrap.sequence = 1;
    movedDestroyedTrap.position = "faceDown";
    movedDestroyedTrap.faceUp = false;
    movedDestroyedTrap.turnId = 0;
    const movedDestroyer = moveDuelCard(session.state, destroyer.uid, "monsterZone", 1);
    movedDestroyer.position = "faceUpAttack";
    movedDestroyer.faceUp = true;
    const movedTargetSpell = moveDuelCard(session.state, targetSpell.uid, "spellTrapZone", 1);
    movedTargetSpell.position = "faceUpAttack";
    movedTargetSpell.faceUp = true;
    const movedMonsterDecoy = moveDuelCard(session.state, monsterDecoy.uid, "monsterZone", 0);
    movedMonsterDecoy.position = "faceUpAttack";
    movedMonsterDecoy.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turn = 1;
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = realDrivingSnowWithLocalSupport(workspace, destroyedTrapCode, destroyerCode, responderCode);
    const host = createLuaScriptHost(session, workspace);
    for (const code of [drivingSnowCode, destroyerCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const destroyAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroyAction, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, destroyAction!);
    resolveEngineChain(session);
    expect(session.state.cards.find((card) => card.uid === destroyedTrap.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      previousController: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: destroyer.uid,
    });
    expect(session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-1-1014",
        eventCardUid: destroyedTrap.uid,
        eventCode: 1014,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventName: "sentToGraveyard",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 1 },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 3,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        id: "trigger-4-1",
        player: 0,
        sourceUid: drivingSnow.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === drivingSnow.uid,
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toHaveLength(1);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1-1014",
        eventCardUid: destroyedTrap.uid,
        eventCode: 1014,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventName: "sentToGraveyard",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 1 },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 3,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        id: "chain-5",
        operationInfos: [{ category: 0x1, targetUids: [targetSpell.uid], count: 1, player: 0, parameter: 0 }],
        player: 0,
        sourceUid: drivingSnow.uid,
        targetFieldIds: [10],
        targetUids: [targetSpell.uid],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === drivingSnow.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === destroyedTrap.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === targetSpell.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === monsterDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChain.host.messages).not.toContain("driving snow responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyedTrap.uid,
        eventPreviousState: { location: "spellTrapZone", controller: 0, sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: targetSpell.uid,
        eventPreviousState: { location: "spellTrapZone", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: drivingSnow.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function realDrivingSnowWithLocalSupport(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  destroyedTrapCode: string,
  destroyerCode: string,
  responderCode: string,
) {
  return {
    readScript(name: string) {
      if (name === `c${destroyerCode}.lua`) return destroyerScript(destroyedTrapCode);
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      return workspace.readScript(name);
    },
  };
}

function destroyerScript(destroyedTrapCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${destroyedTrapCode}),tp,0,LOCATION_SZONE,nil)
        Duel.Destroy(tc,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
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
      e:SetOperation(function(e,tp) Debug.Message("driving snow responder resolved") end)
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveEngineChain(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
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
