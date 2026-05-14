import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dragon's Bind persistent Special Summon lock", () => {
  it("restores official persistent target into both-player Special Summon restrictions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const bindCode = "16278116";
    const targetCode = "613501";
    const lowPlayerCode = "613502";
    const highPlayerCode = "613503";
    const lowOpponentCode = "613504";
    const highOpponentCode = "613505";
    const responderCode = "613506";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === bindCode),
      { code: targetCode, name: "Dragon's Bind Target Dragon", kind: "monster", typeFlags: 0x21, race: 0x2000, level: 4, attack: 2000, defense: 1800 },
      { code: lowPlayerCode, name: "Dragon's Bind Low Player Summon", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1200 },
      { code: highPlayerCode, name: "Dragon's Bind High Player Summon", kind: "monster", typeFlags: 0x1, level: 4, attack: 2100, defense: 1200 },
      { code: lowOpponentCode, name: "Dragon's Bind Low Opponent Summon", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1200 },
      { code: highOpponentCode, name: "Dragon's Bind High Opponent Summon", kind: "monster", typeFlags: 0x1, level: 4, attack: 2200, defense: 1200 },
      { code: responderCode, name: "Dragon's Bind Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 316, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [bindCode, targetCode, lowPlayerCode, highPlayerCode] },
      1: { main: [lowOpponentCode, highOpponentCode, responderCode] },
    });
    startDuel(session);

    const bind = session.state.cards.find((card) => card.code === bindCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const lowPlayer = session.state.cards.find((card) => card.code === lowPlayerCode);
    const highPlayer = session.state.cards.find((card) => card.code === highPlayerCode);
    const lowOpponent = session.state.cards.find((card) => card.code === lowOpponentCode);
    const highOpponent = session.state.cards.find((card) => card.code === highOpponentCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(bind).toBeDefined();
    expect(target).toBeDefined();
    expect(lowPlayer).toBeDefined();
    expect(highPlayer).toBeDefined();
    expect(lowOpponent).toBeDefined();
    expect(highOpponent).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, bind!.uid, "spellTrapZone", 0);
    bind!.position = "faceDown";
    bind!.faceUp = false;
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
    moveDuelCard(session.state, lowPlayer!.uid, "hand", 0);
    moveDuelCard(session.state, highPlayer!.uid, "hand", 0);
    moveDuelCard(session.state, lowOpponent!.uid, "hand", 1);
    moveDuelCard(session.state, highOpponent!.uid, "hand", 1);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bindCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === bind!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.chain[0]).toMatchObject({
      sourceUid: bind!.uid,
      targetUids: [target!.uid],
    });
    expect(restoredActivation.session.state.chain[0]?.operationInfos ?? []).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === bind!.uid)).toMatchObject({
      location: "spellTrapZone",
      cardTargetUids: [target!.uid],
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("dragon bind responder resolved");

    const persistentSnapshot = serializeDuel(restoredChain.session);
    const restoredPersistent = restoreDuelWithLuaScripts(persistentSnapshot, source, reader);
    expectCleanRestore(restoredPersistent);
    const persistentProbe = restoredPersistent.host.loadScript(
      persistentSpecialLockProbeScript(bindCode, targetCode, lowPlayerCode, highPlayerCode, lowOpponentCode, highOpponentCode),
      "dragons-bind-persistent-special-lock-probe.lua",
    );
    expect(persistentProbe.ok, persistentProbe.error).toBe(true);
    expect(restoredPersistent.host.messages).toContain("dragon bind persistent true/true/1/false/true/false/true");

    const restoredTargetDestroyed = restoreDuelWithLuaScripts(persistentSnapshot, source, reader);
    expectCleanRestore(restoredTargetDestroyed);
    destroyDuelCard(restoredTargetDestroyed.session.state, target!.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredTargetDestroyed.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredTargetDestroyed.session.state.cards.find((card) => card.uid === bind!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: duelReason.effect | duelReason.destroy,
    });
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
      e:SetOperation(function(e,tp) Debug.Message("dragon bind responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function persistentSpecialLockProbeScript(bindCode: string, targetCode: string, lowPlayerCode: string, highPlayerCode: string, lowOpponentCode: string, highOpponentCode: string): string {
  return `
    local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${bindCode}),0,LOCATION_SZONE,0,nil)
    local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,nil)
    local lowPlayer=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lowPlayerCode}),0,LOCATION_HAND,0,nil)
    local highPlayer=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${highPlayerCode}),0,LOCATION_HAND,0,nil)
    local lowOpponent=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lowOpponentCode}),0,0,LOCATION_HAND,nil)
    local highOpponent=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${highOpponentCode}),0,0,LOCATION_HAND,nil)
    local persistent=Effect.CreateEffect(trap)
    Debug.Message(
      "dragon bind persistent " ..
      tostring(trap:IsHasCardTarget(target)) .. "/" ..
      tostring(aux.PersistentTargetFilter(persistent,target)) .. "/" ..
      trap:GetCardTargetCount() .. "/" ..
      tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,lowPlayer)) .. "/" ..
      tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,highPlayer)) .. "/" ..
      tostring(Duel.IsPlayerCanSpecialSummon(1,0,POS_FACEUP_ATTACK,1,lowOpponent)) .. "/" ..
      tostring(Duel.IsPlayerCanSpecialSummon(1,0,POS_FACEUP_ATTACK,1,highOpponent))
    )
  `;
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

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
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
