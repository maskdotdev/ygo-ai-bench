import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const fairyBoxCode = "21598948";
const typeMonster = 0x1;
const categoryCoin = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fairy Box CallCoin attack zero", () => {
  it("restores attack-announcement CallCoin and sets the attacking monster's ATK to 0", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const attackerCode = "215989480";
    const targetCode = "215989481";
    const responderCode = "215989482";
    const script = workspace.readScript(`c${fairyBoxCode}.lua`);
    expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("Duel.SetTargetCard(Duel.GetAttacker())");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
    expect(script).toContain("if Duel.CallCoin(tp,1) then");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(0)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === fairyBoxCode),
      { code: attackerCode, name: "Fairy Box Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1900, defense: 1000 },
      { code: targetCode, name: "Fairy Box Attack Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Fairy Box Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fairyBoxCode, targetCode] }, 1: { main: [attackerCode, responderCode] } });
    startDuel(session);

    const fairyBox = requireCard(session, fairyBoxCode);
    const attacker = requireCard(session, attackerCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, fairyBox.uid, "spellTrapZone", 0).position = "faceUpAttack";
    fairyBox.faceUp = true;
    moveDuelCard(session.state, attacker.uid, "monsterZone", 1).position = "faceUpAttack";
    attacker.faceUp = true;
    moveDuelCard(session.state, target.uid, "monsterZone", 0).position = "faceUpAttack";
    target.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fairyBoxCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingBattle).toMatchObject({ attackerUid: attacker.uid, targetUid: target.uid });
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1130",
        sourceUid: fairyBox.uid,
        player: 0,
        triggerBucket: "opponentMandatory",
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: attacker.uid,
        eventPlayer: 1,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        eventUids: [attacker.uid, target.uid],
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === fairyBox.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(trigger)).not.toContain("operationInfos");
    applyRestored(restoredTrigger, trigger!);
    while (restoredTrigger.session.state.chain.length > 0) passChain(restoredTrigger, restoredTrigger.session.state.waitingFor ?? restoredTrigger.session.state.turnPlayer);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.lastCoinResults).toEqual([1]);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === attacker.uid), restoredTrigger.session.state)).toBe(0);
    expect(restoredTrigger.session.state.pendingBattle).toMatchObject({ attackerUid: attacker.uid, targetUid: target.uid });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "coinTossed")).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: fairyBox.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(host.messages).not.toContain("fairy box responder resolved");
    expect(restoredTrigger.host.messages).not.toContain("fairy box responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("fairy box responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestored(restored, pass!);
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
}

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
