import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import {
  applyLuaRestoreResponse,
  getLuaRestoreLegalActionGroups,
  getLuaRestoreLegalActions,
  restoreDuelWithLuaScripts,
} from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Power Filter special summon lock", () => {
  it("restores official Continuous Spell both-player 1000-or-less ATK Special Summon restriction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const powerFilterCode = "19844995";
    const lowPlayerCode = "19844001";
    const equalPlayerCode = "19844002";
    const highPlayerCode = "19844003";
    const lowOpponentCode = "19844004";
    const equalOpponentCode = "19844005";
    const highOpponentCode = "19844006";
    const responderCode = "19844007";
    const script = workspace.readScript(`c${powerFilterCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("e2:SetTargetRange(1,1)");
    expect(script).toContain("return c:IsAttackBelow(1000)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === powerFilterCode),
      { code: lowPlayerCode, name: "Power Filter Low Player Probe", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 1000 },
      { code: equalPlayerCode, name: "Power Filter Equal Player Probe", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: highPlayerCode, name: "Power Filter High Player Probe", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1100, defense: 1000 },
      { code: lowOpponentCode, name: "Power Filter Low Opponent Probe", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 1000 },
      { code: equalOpponentCode, name: "Power Filter Equal Opponent Probe", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: highOpponentCode, name: "Power Filter High Opponent Probe", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1100, defense: 1000 },
      { code: responderCode, name: "Power Filter Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1984, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [powerFilterCode, lowPlayerCode, equalPlayerCode, highPlayerCode] },
      1: { main: [lowOpponentCode, equalOpponentCode, highOpponentCode, responderCode] },
    });
    startDuel(session);

    const powerFilter = session.state.cards.find((card) => card.code === powerFilterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(powerFilter).toBeDefined();
    expect(responder).toBeDefined();
    for (const code of [
      powerFilterCode,
      lowPlayerCode,
      equalPlayerCode,
      highPlayerCode,
      lowOpponentCode,
      equalOpponentCode,
      highOpponentCode,
      responderCode,
    ]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", card!.owner);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(powerFilterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === powerFilter!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    const chainLink = restoredActivation.session.state.chain[0];
    expect(chainLink?.activationLocation).toBe("hand");
    expect(chainLink?.activationSequence).toBe(0);
    expect(chainLink?.chainIndex).toBe(1);
    expect(chainLink?.player).toBe(0);
    expect(chainLink?.sourceUid).toBe(powerFilter!.uid);
    expect(chainLink?.targetUids ?? []).toEqual([]);
    expect(chainLink?.operationInfos ?? []).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === powerFilter!.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("power filter responder resolved");

    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, restoredPersistent.session.state.waitingFor ?? restoredPersistent.session.state.turnPlayer);
    expect(restoredPersistent.session.state.effects.find((effect) => effect.sourceUid === powerFilter!.uid && effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "target:attack-below:1000",
      property: 0x800,
      targetRange: [1, 1],
    });
    const probe = restoredPersistent.host.loadScript(
      persistentSpecialLockProbeScript(lowPlayerCode, equalPlayerCode, highPlayerCode, lowOpponentCode, equalOpponentCode, highOpponentCode),
      "power-filter-special-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredPersistent.host.messages).toContain("power filter can special false/false/true/false/false/true");
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
      e:SetOperation(function(e,tp) Debug.Message("power filter responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function persistentSpecialLockProbeScript(
  lowPlayerCode: string,
  equalPlayerCode: string,
  highPlayerCode: string,
  lowOpponentCode: string,
  equalOpponentCode: string,
  highOpponentCode: string,
): string {
  return `
    local lowPlayer=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lowPlayerCode}),0,LOCATION_HAND,0,nil)
    local equalPlayer=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${equalPlayerCode}),0,LOCATION_HAND,0,nil)
    local highPlayer=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${highPlayerCode}),0,LOCATION_HAND,0,nil)
    local lowOpponent=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lowOpponentCode}),0,0,LOCATION_HAND,nil)
    local equalOpponent=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${equalOpponentCode}),0,0,LOCATION_HAND,nil)
    local highOpponent=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${highOpponentCode}),0,0,LOCATION_HAND,nil)
    Debug.Message(
      "power filter can special " ..
      tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,lowPlayer)) .. "/" ..
      tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,equalPlayer)) .. "/" ..
      tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,highPlayer)) .. "/" ..
      tostring(Duel.IsPlayerCanSpecialSummon(1,0,POS_FACEUP_ATTACK,1,lowOpponent)) .. "/" ..
      tostring(Duel.IsPlayerCanSpecialSummon(1,0,POS_FACEUP_ATTACK,1,equalOpponent)) .. "/" ..
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
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
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
