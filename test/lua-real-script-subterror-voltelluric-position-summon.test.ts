import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const voltelluricCode = "21607304";
const setterCode = "216073040";
const responderCode = "216073041";
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeEarth = 0x1;
const raceThunder = 0x1000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Subterror Behemoth Voltelluric position summon", () => {
  it("restores face-up-to-face-down position trigger into hand Special Summon in Defense", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${voltelluricCode}.lua`);
    expect(script).toContain("e2:SetCode(EVENT_CHANGE_POS)");
    expect(script).toContain("return c:IsPreviousPosition(POS_FACEUP) and c:IsFacedown() and c:IsControler(tp)");
    expect(script).toContain("not Duel.IsExistingMatchingCard(Card.IsFaceup,tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");

    const voltelluric = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === voltelluricCode);
    expect(voltelluric).toBeDefined();
    const cards: DuelCardData[] = [
      voltelluric!,
      { code: setterCode, name: "Voltelluric Position Setter", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, race: raceThunder, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Voltelluric Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, race: raceThunder, level: 4, attack: 800, defense: 800 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 21607304, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [voltelluricCode, setterCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const voltelluricCard = requireCard(session, voltelluricCode);
    const setter = requireCard(session, setterCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, voltelluricCard.uid, "hand", 0);
    moveFaceUpAttack(session, setter, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${setterCode}.lua`) return setterScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(voltelluricCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(setterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const setAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === setter.uid);
    expect(setAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, setAction!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        activationLocation: "monsterZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-4",
        id: "chain-2",
        operationInfos: [{ category: 0x1000, count: 1, parameter: 8, player: 0, targetUids: [setter.uid] }],
        player: 0,
        sourceUid: setter.uid,
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("voltelluric responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === setter.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: false,
      position: "faceDownDefense",
      previousPosition: "faceUpAttack",
      reason: 0,
      reasonPlayer: 0,
      reasonCardUid: setter.uid,
      reasonEffectId: 4,
    });
    expect(restoredChain.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
    }))).toEqual([
      {
        effectId: "lua-2-1016",
        eventCardUid: setter.uid,
        eventName: "positionChanged",
        eventReason: duelReason.effect,
        eventReasonCardUid: setter.uid,
        eventReasonEffectId: 4,
        eventReasonPlayer: 0,
        player: 0,
        sourceUid: voltelluricCard.uid,
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === voltelluricCard.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        activationLocation: "hand",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-2-1016",
        eventCardUid: setter.uid,
        eventCode: 1016,
        eventCurrentState: { controller: 0, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
        eventName: "positionChanged",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonCardUid: setter.uid,
        eventReasonEffectId: 4,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        id: "chain-5",
        operationInfos: [{ category: 0x200, count: 1, parameter: 0, player: 0, targetUids: [voltelluricCard.uid] }],
        player: 0,
        sourceUid: voltelluricCard.uid,
      },
    ]);

    const restoredSummonChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredSummonChain);
    expectRestoredLegalActions(restoredSummonChain, 1);
    expect(getLuaRestoreLegalActions(restoredSummonChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredSummonChain);
    expect(restoredSummonChain.host.messages).not.toContain("voltelluric responder resolved");
    expect(restoredSummonChain.session.state.cards.find((card) => card.uid === voltelluricCard.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: voltelluricCard.uid,
      reasonEffectId: 2,
    });
    expect(restoredSummonChain.session.state.eventHistory.filter((event) => ["positionChanged", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: setter.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: setter.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: voltelluricCard.uid,
        eventUids: [voltelluricCard.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: voltelluricCard.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 1 },
      },
    ]);
  });
});

function setterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_POSITION)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        local c=e:GetHandler()
        if chk==0 then return c:IsCanTurnSet() end
        Duel.SetOperationInfo(0,CATEGORY_POSITION,c,1,tp,POS_FACEDOWN_DEFENSE)
      end)
      e:SetOperation(function(e,tp)
        local c=e:GetHandler()
        if c:IsRelateToEffect(e) and c:IsFaceup() then
          Duel.ChangePosition(c,POS_FACEDOWN_DEFENSE)
        end
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
      e:SetOperation(function(e,tp) Debug.Message("voltelluric responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
