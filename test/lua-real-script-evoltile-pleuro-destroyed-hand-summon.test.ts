import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { ApplyDuelResponseResult, DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPleuroScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c20855340.lua"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setEvolsaur = 0x604e;

describe.skipIf(!hasUpstreamScripts || !hasPleuroScript)("Lua real script Evoltile Pleuro destroyed hand summon", () => {
  it("restores delayed destroyed-from-field EVENT_TO_GRAVE hand Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const pleuroCode = "20855340";
    const evolsaurCode = "20855341";
    const offSetCode = "20855342";
    const destroyerCode = "20855343";
    const responderCode = "20855344";
    const script = workspace.readScript(`c${pleuroCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
    expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
    expect(script).toContain("e:GetHandler():IsReason(REASON_DESTROY)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)");
    expect(script).toContain("Duel.SpecialSummon(g,153,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: pleuroCode, name: "Evoltile Pleuro", kind: "monster", typeFlags: typeMonster | typeEffect, level: 1, attack: 200, defense: 200 },
      { code: evolsaurCode, name: "Evoltile Pleuro Evolsaur Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setEvolsaur], level: 4, attack: 1700, defense: 1200 },
      { code: offSetCode, name: "Evoltile Pleuro Off-Set Hand Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000 },
      { code: destroyerCode, name: "Evoltile Pleuro Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Evoltile Pleuro Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 20855340, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [pleuroCode, evolsaurCode, offSetCode, destroyerCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const pleuro = requireCard(session, pleuroCode);
    const evolsaur = requireCard(session, evolsaurCode);
    const offSet = requireCard(session, offSetCode);
    const destroyer = requireCard(session, destroyerCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, pleuro.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, evolsaur.uid, "hand", 0);
    moveDuelCard(session.state, offSet.uid, "hand", 0);
    moveDuelCard(session.state, destroyer.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${destroyerCode}.lua`) return destroyerScript(pleuroCode);
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [pleuroCode, destroyerCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const destroy = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroy, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, destroy!);
    resolveEngineChain(session);

    expect(session.state.cards.find((card) => card.uid === pleuro.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: destroyer.uid,
    });
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        player: 0,
        effectId: "lua-1-1014",
        sourceUid: pleuro.uid,
        triggerBucket: "turnOptional",
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: pleuro.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 2,
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
          sequence: 0,
        },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === pleuro.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain[0]).toEqual({
      id: "chain-5",
      chainIndex: 1,
      effectId: "lua-1-1014",
      sourceUid: pleuro.uid,
      player: 0,
      activationLocation: "graveyard",
      activationSequence: 0,
      eventName: "sentToGraveyard",
      eventCode: 1014,
      eventCardUid: pleuro.uid,
      eventReason: duelReason.effect | duelReason.destroy,
      eventReasonPlayer: 0,
      eventReasonCardUid: destroyer.uid,
      eventReasonEffectId: 2,
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
        sequence: 0,
      },
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === pleuro.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offSet.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === evolsaur.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: pleuro.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === evolsaur.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: evolsaur.uid,
        eventUids: [evolsaur.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: pleuro.uid,
        eventReasonEffectId: 1,
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
      },
    ]);
    expect(restoredChain.host.messages).not.toContain("evoltile responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function destroyerScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingMatchingCard(Card.IsCode,tp,LOCATION_MZONE,0,1,nil,${targetCode}) end
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetMatchingGroup(Card.IsCode,tp,LOCATION_MZONE,0,nil,${targetCode}):GetFirst()
        if tc then Duel.Destroy(tc,REASON_EFFECT) end
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
      e:SetOperation(function(e,tp) Debug.Message("evoltile responder resolved") end)
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

function applyAndAssert(session: DuelSession, action: DuelAction): ApplyDuelResponseResult {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
  return response;
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
    const response = applyLuaRestoreResponse(restored, pass!);
    expect(response.ok, response.error).toBe(true);
  }
}
