import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const callReaperCode = "45133463";
const hasCallReaperScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${callReaperCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasCallReaperScript)("Lua real script Call of the Reaper Special Summon success target revive", () => {
  it("restores EVENT_SPSUMMON_SUCCESS Trap activation targeting a listed monster in Graveyard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const graveSummonedCode = "45133464";
    const listedTargetCode = "78552773";
    const offCodeTargetCode = "45133465";
    const starterCode = "45133466";
    const responderCode = "45133467";
    const script = workspace.readScript(`c${callReaperCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return c:IsPreviousLocation(LOCATION_GRAVE) and c:IsPreviousControler(tp)");
    expect(script).toContain("return c:IsCode(78552773,78275321) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,LOCATION_GRAVE,0,1,nil,e,tp)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,0,0)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: callReaperCode, name: "Call of the Reaper", kind: "trap", typeFlags: typeTrap },
      { code: graveSummonedCode, name: "Call Reaper Grave Starter Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000 },
      { code: listedTargetCode, name: "Call Reaper Listed Revive Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000 },
      { code: offCodeTargetCode, name: "Call Reaper Off-Code Grave Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1700, defense: 1000 },
      { code: starterCode, name: "Call Reaper Special Summon Starter", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Call Reaper Chain Responder", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 45133463, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [callReaperCode, graveSummonedCode, listedTargetCode, offCodeTargetCode, starterCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const callReaper = requireCard(session, callReaperCode);
    const graveSummoned = requireCard(session, graveSummonedCode);
    const listedTarget = requireCard(session, listedTargetCode);
    const offCodeTarget = requireCard(session, offCodeTargetCode);
    const starter = requireCard(session, starterCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, callReaper.uid, "spellTrapZone", 0);
    callReaper.position = "faceDown";
    callReaper.faceUp = false;
    moveDuelCard(session.state, graveSummoned.uid, "graveyard", 0);
    moveDuelCard(session.state, listedTarget.uid, "graveyard", 0);
    moveDuelCard(session.state, offCodeTarget.uid, "graveyard", 0);
    moveDuelCard(session.state, starter.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return specialSummonStarterScript(graveSummonedCode);
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [callReaperCode, starterCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toEqual([
      {
        activationLocation: "hand",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-2-1002",
        id: "chain-2",
        operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x10 }],
        player: 0,
        sourceUid: starter.uid,
      },
    ]);
    resolveEngineChain(session);

    expect(session.state.cards.find((card) => card.uid === graveSummoned.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: starter.uid,
      reasonEffectId: 2,
    });
    expect(session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === graveSummoned.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: graveSummoned.uid,
        eventUids: [graveSummoned.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: starter.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
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
      },
    ]);

    const restoredActivationWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivationWindow);
    expectRestoredLegalActions(restoredActivationWindow, 0);
    const callAction = getLuaRestoreLegalActions(restoredActivationWindow, 0).find(
      (action) => action.type === "activateEffect" && action.uid === callReaper.uid,
    );
    expect(callAction, JSON.stringify(getLuaRestoreLegalActions(restoredActivationWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivationWindow, callAction!);
    expect(restoredActivationWindow.session.state.chain).toEqual([
      {
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1-1102",
        eventCardUid: graveSummoned.uid,
        eventCode: 1102,
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventName: "specialSummoned",
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonCardUid: starter.uid,
        eventReasonEffectId: 2,
        eventReasonPlayer: 0,
        eventUids: [graveSummoned.uid],
        id: "chain-6",
        operationInfos: [{ category: 0x200, targetUids: [listedTarget.uid], count: 1, player: 0, parameter: 0 }],
        player: 0,
        sourceUid: callReaper.uid,
        targetFieldIds: [9],
        targetUids: [listedTarget.uid],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivationWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === callReaper.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offCodeTarget.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === listedTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 1,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: callReaper.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === listedTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: listedTarget.uid,
        eventUids: [listedTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: callReaper.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
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
    expect(restoredChain.host.messages).not.toContain("call reaper responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function specialSummonStarterScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0
          and Duel.IsExistingMatchingCard(Card.IsCode,tp,LOCATION_GRAVE,0,1,nil,${targetCode}) end
        Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_GRAVE)
      end)
      e:SetOperation(function(e,tp)
        local g=Duel.SelectMatchingCard(tp,Card.IsCode,tp,LOCATION_GRAVE,0,1,1,nil,${targetCode})
        Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)
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
      e:SetOperation(function(e,tp) Debug.Message("call reaper responder resolved") end)
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
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function resolveEngineChain(session: DuelSession): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLegalActions(session, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player!), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
