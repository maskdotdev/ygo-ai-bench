import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeToken = 0x4000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Token Sundae BreakEffect select destroy", () => {
  it("restores token group destruction, BreakEffect, and second-wave selected destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const tokenSundaeCode = "52971673";
    const firstTokenCode = "529716730";
    const secondTokenCode = "529716731";
    const ownSecondWaveCode = "529716732";
    const opponentSecondWaveCode = "529716733";
    const responderCode = "529716734";
    const script = workspace.readScript(`c${tokenSundaeCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("Duel.GetMatchingGroup(s.cfilter,tp,LOCATION_MZONE,0,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)");
    expect(script).toContain("local dt=Duel.Destroy(g,REASON_EFFECT)");
    expect(script).toContain("if dt==0 then return end");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("local sg=dg:Select(tp,1,dt,nil)");
    expect(script).toContain("Duel.HintSelection(sg)");
    expect(script).toContain("Duel.Destroy(sg,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === tokenSundaeCode),
      { code: firstTokenCode, name: "Token Sundae First Token", kind: "monster", typeFlags: typeMonster | typeToken, level: 1, attack: 0, defense: 0 },
      { code: secondTokenCode, name: "Token Sundae Second Token", kind: "monster", typeFlags: typeMonster | typeToken, level: 1, attack: 0, defense: 0 },
      { code: ownSecondWaveCode, name: "Token Sundae Own Second-Wave Spell", kind: "spell", typeFlags: typeSpell },
      { code: opponentSecondWaveCode, name: "Token Sundae Opponent Second-Wave Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200 },
      { code: responderCode, name: "Token Sundae Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 52971673, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [tokenSundaeCode, firstTokenCode, secondTokenCode, ownSecondWaveCode] },
      1: { main: [opponentSecondWaveCode, responderCode] },
    });
    startDuel(session);

    const tokenSundae = requireCard(session, tokenSundaeCode);
    const firstToken = requireCard(session, firstTokenCode);
    const secondToken = requireCard(session, secondTokenCode);
    const ownSecondWave = requireCard(session, ownSecondWaveCode);
    const opponentSecondWave = requireCard(session, opponentSecondWaveCode);
    const responder = requireCard(session, responderCode);
    const movedTrap = moveDuelCard(session.state, tokenSundae.uid, "spellTrapZone", 0);
    movedTrap.position = "faceDown";
    movedTrap.faceUp = false;
    movedTrap.turnId = 0;
    const movedFirstToken = moveDuelCard(session.state, firstToken.uid, "monsterZone", 0);
    movedFirstToken.sequence = 0;
    movedFirstToken.position = "faceUpAttack";
    movedFirstToken.faceUp = true;
    const movedSecondToken = moveDuelCard(session.state, secondToken.uid, "monsterZone", 0);
    movedSecondToken.sequence = 1;
    movedSecondToken.position = "faceUpAttack";
    movedSecondToken.faceUp = true;
    const movedOwnSecondWave = moveDuelCard(session.state, ownSecondWave.uid, "spellTrapZone", 0);
    movedOwnSecondWave.sequence = 1;
    movedOwnSecondWave.position = "faceUpAttack";
    movedOwnSecondWave.faceUp = true;
    const movedOpponentSecondWave = moveDuelCard(session.state, opponentSecondWave.uid, "monsterZone", 1);
    movedOpponentSecondWave.position = "faceUpAttack";
    movedOpponentSecondWave.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turn = 1;
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tokenSundaeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenWindow);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const action = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === tokenSundae.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenWindow, action!);
    const tokenUids = [firstToken.uid, secondToken.uid];
    expect(restoredOpenWindow.session.state.chain).toHaveLength(1);
    expect(restoredOpenWindow.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: tokenSundae.uid,
        player: 0,
        effectId: "lua-1-1002",
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        operationInfos: [{ category: 0x1, targetUids: tokenUids, count: 2, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expectCleanRestore(restoredChainWindow);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(getLuaRestoreLegalActions(restoredChainWindow, 1).some((candidate) => candidate.type === "activateEffect" && candidate.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("chainResponse");
    applyLuaRestoreAndAssert(restoredChainWindow, pass!);

    expect(restoredChainWindow.session.state.chain).toEqual([]);
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === tokenSundae.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === firstToken.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === secondToken.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === ownSecondWave.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === opponentSecondWave.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChainWindow.host.messages).not.toContain("token sundae responder resolved");
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: firstToken.uid,
        eventPreviousState: { location: "monsterZone", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: tokenSundae.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: secondToken.uid,
        eventPreviousState: { location: "monsterZone", controller: 0, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: tokenSundae.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: firstToken.uid,
        eventUids: tokenUids,
        eventPreviousState: { location: "monsterZone", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: tokenSundae.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownSecondWave.uid,
        eventPreviousState: { location: "spellTrapZone", controller: 0, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 2, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: tokenSundae.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentSecondWave.uid,
        eventPreviousState: { location: "monsterZone", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: tokenSundae.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownSecondWave.uid,
        eventUids: [ownSecondWave.uid, opponentSecondWave.uid],
        eventPreviousState: { location: "spellTrapZone", controller: 0, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 2, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: tokenSundae.uid,
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

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("token sundae responder resolved") end)
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
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
