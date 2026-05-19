import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, synchroSummonDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Kagetokage summon trigger self Special Summon", () => {
  it("restores hand-range summon-success self Special Summon and unsynchroable material lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const kagetokageCode = "94656263";
    const level4SummonCode = "94656264";
    const tunerCode = "94656265";
    const synchroCode = "94656266";
    const responderCode = "94656267";
    const script = workspace.readScript(`c${kagetokageCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("return ep==tp and ec:GetLevel()==4");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,true,false,POS_FACEUP)");
    expect(script).toContain("c:CompleteProcedure()");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_BE_SYNCHRO_MATERIAL)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === kagetokageCode),
      { code: level4SummonCode, name: "Kagetokage Level 4 Summon", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1000 },
      { code: tunerCode, name: "Kagetokage Synchro Tuner", kind: "monster", typeFlags: typeMonster | typeTuner, level: 4, attack: 1000, defense: 1000 },
      { code: synchroCode, name: "Kagetokage Synchro Probe", kind: "extra", typeFlags: typeMonster | typeSynchro, level: 8, attack: 2400, defense: 2000, synchroMaterials: { tuner: tunerCode, nonTuners: [kagetokageCode] } },
      { code: responderCode, name: "Kagetokage Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 94656263, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [kagetokageCode, level4SummonCode, tunerCode], extra: [synchroCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const kagetokage = requireCard(session, kagetokageCode);
    const level4Summon = requireCard(session, level4SummonCode);
    const tuner = requireCard(session, tunerCode);
    const synchro = requireCard(session, synchroCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, tuner.uid, "monsterZone", 0);
    moveDuelCard(session.state, kagetokage.uid, "hand", 0);
    moveDuelCard(session.state, level4Summon.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kagetokageCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredSummonWindow);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === level4Summon.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const previousSummonedState = cardEventState(level4Summon);
    const currentSummonedState = { ...previousSummonedState, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 };
    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1100",
        sourceUid: kagetokage.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: level4Summon.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: previousSummonedState,
        eventCurrentState: currentSummonedState,
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === kagetokage.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-2-1100",
        sourceUid: kagetokage.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: level4Summon.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: previousSummonedState,
        eventCurrentState: currentSummonedState,
        operationInfos: [{ category: 0x200, targetUids: [kagetokage.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredChainWindow);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(getLuaRestoreLegalActions(restoredChainWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passChain(restoredChainWindow);

    expect(restoredChainWindow.session.state.chain).toHaveLength(0);
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === kagetokage.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 2,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: kagetokage.uid,
      reasonEffectId: 2,
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === level4Summon.uid)).toMatchObject({ location: "monsterZone", sequence: 1 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === tuner.uid)).toMatchObject({ location: "monsterZone", sequence: 0 });
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === kagetokage.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: kagetokage.uid,
        eventUids: [kagetokage.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: kagetokage.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
      },
    ]);
    const materialLock = restoredChainWindow.session.state.effects.find((effect) => effect.sourceUid === kagetokage.uid && effect.code === 236);
    expect(materialLock).toMatchObject({
      id: "lua-3-236",
      event: "continuous",
      value: 1,
    });
    expect(materialLock?.range).toEqual(expect.arrayContaining(["hand", "monsterZone"]));
    expect(getLegalActions(restoredChainWindow.session, 0).some((action) => action.type === "synchroSummon" && action.uid === synchro.uid)).toBe(false);
    expect(() => synchroSummonDuelCard(restoredChainWindow.session.state, 0, synchro.uid, [tuner.uid, kagetokage.uid])).toThrow("cannot be used as synchro material");
    expect(restoredChainWindow.host.messages).not.toContain("kagetokage responder resolved");
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function cardEventState(card: DuelCardInstance) {
  return {
    controller: card.controller,
    faceUp: card.faceUp,
    location: card.location,
    position: card.position,
    sequence: card.sequence,
  };
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
      e:SetOperation(function(e,tp) Debug.Message("kagetokage responder resolved") end)
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

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
