import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const rhinoCode = "74289646";
const starterCode = "74289647";
const drawCode = "74289648";
const responderCode = "74289649";
const defenderCode = "74289650";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Royal Rhino chain dice ATK", () => {
  it("restores its EVENT_CHAINING CL2 dice response into temporary ATK gain before the starter chain resolves", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rhinoCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DICE+CATEGORY_ATKCHANGE+CATEGORY_DAMAGE+CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)");
    expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DICE,nil,1,tp,0)");
    expect(script).toContain("if chain_link==2 then");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,tp,500)");
    expect(script).toContain("local res=Duel.TossDice(tp,1)");
    expect(script).toContain("local chain_link=Duel.GetCurrentChain()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(res*500)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === rhinoCode),
      { code: starterCode, name: "Royal Rhino Starter Spell", kind: "spell", typeFlags: typeSpell },
      { code: drawCode, name: "Royal Rhino Draw Card", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Royal Rhino Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: defenderCode, name: "Royal Rhino Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 74289646, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, drawCode, responderCode, defenderCode] }, 1: { main: [rhinoCode] } });
    startDuel(session);

    const starter = requireCard(session, starterCode);
    const draw = requireCard(session, drawCode);
    const responder = requireCard(session, responderCode);
    const defender = requireCard(session, defenderCode);
    const rhino = requireCard(session, rhinoCode);
    moveDuelCard(session.state, starter.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 0);
    moveDuelCard(session.state, defender.uid, "monsterZone", 0);
    defender.faceUp = true;
    defender.position = "faceUpAttack";
    moveDuelCard(session.state, rhino.uid, "monsterZone", 1);
    rhino.faceUp = true;
    rhino.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return starterDrawScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(rhinoCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const starterAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, starterAction!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: starter.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 }],
      },
    ]);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 1);
    const rhinoAction = getLuaRestoreLegalActions(restoredResponse, 1).find((action) => action.type === "activateEffect" && action.uid === rhino.uid);
    expect(rhinoAction, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 1), null, 2)).toBeDefined();
    applyRestoredAction(restoredResponse, rhinoAction!);
    expect(restoredResponse.session.state.chain[1]).toMatchObject({
      id: "chain-3",
      chainIndex: 2,
      effectId: "lua-3-1027",
      sourceUid: rhino.uid,
      player: 1,
      activationLocation: "monsterZone",
      activationSequence: 0,
      eventName: "chaining",
      eventCode: 1027,
      eventPlayer: 0,
      eventValue: 1,
      eventReasonPlayer: 0,
      eventChainDepth: 1,
      eventChainLinkId: "chain-2",
      eventCardUid: starter.uid,
      operationInfos: [
        { category: 0x2000000, targetUids: [], count: 1, player: 1, parameter: 0 },
        { category: 0x200000, targetUids: [rhino.uid], count: 1, player: 1, parameter: 500 },
      ],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 0);
    expect(getLuaRestoreLegalActions(restoredChain, 0).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredChain);

    const [die] = restoredChain.session.state.lastDiceResults;
    expect(die).toBe(4);
    const attackGain = die! * 500;
    expect(restoredChain.host.messages).not.toContain("royal rhino responder resolved");
    expect(restoredChain.host.messages).toContain("royal rhino starter resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === draw.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === rhino.uid), restoredChain.session.state)).toBe((rhino.data.attack ?? 0) + attackGain);
    expect(restoredChain.session.state.randomCounter).toBe(1);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "diceTossed")).toEqual([
      {
        eventName: "diceTossed",
        eventCode: 1150,
        eventPlayer: 1,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: rhino.uid,
        eventReasonEffectId: 3,
      },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn")).toEqual([
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: draw.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: starter.uid,
        eventReasonEffectId: 1,
        eventUids: [draw.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 1;
    restoredBattle.session.state.waitingFor = 1;
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "declareAttack" && action.attackerUid === rhino.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredAction(restoredBattle, attack!);
    passRestoredBattleResponses(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: (rhino.data.attack ?? 0) + attackGain - (defender.data.attack ?? 0), 1: 0 });
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(8000 - ((rhino.data.attack ?? 0) + attackGain - (defender.data.attack ?? 0)));
  });
});

function starterDrawScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("royal rhino starter resolved")
        Duel.Draw(tp,1,REASON_EFFECT)
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("royal rhino responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAction(restored, pass!);
  }
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAction(restored, pass!);
  }
}
