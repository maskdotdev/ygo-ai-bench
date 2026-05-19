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
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const morayCode = "73244186";
const fishCostCode = "732441860";
const warriorDecoyCode = "732441861";
const firstDrawCode = "732441862";
const secondDrawCode = "732441863";
const responderCode = "732441864";
const typeMonster = 0x1;
const raceFish = 0x20000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Moray of Avarice field banish draw", () => {
  it("restores its face-up Fish field banish cost into CHAININFO-targeted draw two", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${morayCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("c:IsFaceup() and c:IsRace(RACE_FISH|RACE_SEASERPENT|RACE_AQUA) and c:IsAbleToRemoveAsCost()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.drcostfilter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.SetTargetParam(2)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,2)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.Draw(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === morayCode),
      { code: fishCostCode, name: "Moray of Avarice Fixture Fish Cost", kind: "monster", typeFlags: typeMonster, race: raceFish, level: 4, attack: 1500, defense: 1000 },
      { code: warriorDecoyCode, name: "Moray of Avarice Fixture Warrior Decoy", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1500, defense: 1000 },
      { code: firstDrawCode, name: "Moray of Avarice Fixture First Draw", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
      { code: secondDrawCode, name: "Moray of Avarice Fixture Second Draw", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Moray of Avarice Fixture Chain Responder", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 73244186, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [morayCode, fishCostCode, warriorDecoyCode, firstDrawCode, secondDrawCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const moray = requireCard(session, morayCode);
    const fishCost = requireCard(session, fishCostCode);
    const warriorDecoy = requireCard(session, warriorDecoyCode);
    const firstDraw = requireCard(session, firstDrawCode);
    const secondDraw = requireCard(session, secondDrawCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, moray.uid, "hand", 0);
    moveDuelCard(session.state, fishCost.uid, "monsterZone", 0);
    fishCost.faceUp = true;
    fishCost.position = "faceUpAttack";
    moveDuelCard(session.state, warriorDecoy.uid, "monsterZone", 0);
    warriorDecoy.faceUp = true;
    warriorDecoy.position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(morayCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === moray.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.cards.find((card) => card.uid === fishCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: moray.uid,
      reasonEffectId: 1,
    });
    expect(session.state.cards.find((card) => card.uid === warriorDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: moray.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 2 }],
        targetParam: 2,
        targetPlayer: 0,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chain).toEqual(session.state.chain);
    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);

    expect(restored.host.messages).not.toContain("moray of avarice responder resolved");
    expect(restored.session.state.cards.find((card) => card.uid === moray.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === fishCost.uid)).toMatchObject({ location: "banished", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === warriorDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === firstDraw.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === secondDraw.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => ["banished", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: fishCost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: moray.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: secondDraw.uid,
        eventPlayer: 0,
        eventValue: 2,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: moray.uid,
        eventReasonEffectId: 1,
        eventUids: [secondDraw.uid, firstDraw.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
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
      e:SetOperation(function(e,tp) Debug.Message("moray of avarice responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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
