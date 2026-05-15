import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Light of Intervention set lock", () => {
  it("restores official player-targeted monster Set and turn-Set restrictions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lightCode = "62867251";
    const playerHandCode = "614301";
    const opponentHandCode = "614302";
    const fieldMonsterCode = "614303";
    const responderCode = "614304";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === lightCode),
      { code: playerHandCode, name: "Light of Intervention Player Hand Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1000 },
      { code: opponentHandCode, name: "Light of Intervention Opponent Hand Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000 },
      { code: fieldMonsterCode, name: "Light of Intervention Field Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1700, defense: 1000 },
      { code: responderCode, name: "Light of Intervention Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6286, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lightCode, playerHandCode] }, 1: { main: [opponentHandCode, fieldMonsterCode, responderCode] } });
    startDuel(session);

    const light = session.state.cards.find((card) => card.code === lightCode);
    const playerHandMonster = session.state.cards.find((card) => card.code === playerHandCode);
    const opponentHandMonster = session.state.cards.find((card) => card.code === opponentHandCode);
    const fieldMonster = session.state.cards.find((card) => card.code === fieldMonsterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(light).toBeDefined();
    expect(playerHandMonster).toBeDefined();
    expect(opponentHandMonster).toBeDefined();
    expect(fieldMonster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, light!.uid, "spellTrapZone", 0);
    light!.position = "faceDown";
    light!.faceUp = false;
    moveDuelCard(session.state, playerHandMonster!.uid, "hand", 0);
    moveDuelCard(session.state, opponentHandMonster!.uid, "hand", 1);
    moveDuelCard(session.state, fieldMonster!.uid, "monsterZone", 1);
    fieldMonster!.position = "faceUpAttack";
    fieldMonster!.faceUp = true;
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
    expect(host.loadCardScript(Number(lightCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "setMonster", uid: playerHandMonster!.uid })]),
    );
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === light!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.chain[0]).toMatchObject({ sourceUid: light!.uid });
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === light!.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("light of intervention responder resolved");

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredLock, 0);
    const playerActions = getLuaRestoreLegalActions(restoredLock, 0);
    expect(playerActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "normalSummon", uid: playerHandMonster!.uid })]));
    expect(playerActions.some((action) => action.type === "setMonster" && action.uid === playerHandMonster!.uid)).toBe(false);

    restoredLock.session.state.turnPlayer = 1;
    restoredLock.session.state.phase = "main1";
    restoredLock.session.state.waitingFor = 1;
    const opponentActions = getLuaRestoreLegalActions(restoredLock, 1);
    expect(opponentActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "normalSummon", uid: opponentHandMonster!.uid })]));
    expect(opponentActions.some((action) => action.type === "setMonster" && action.uid === opponentHandMonster!.uid)).toBe(false);

    const probe = restoredLock.host.loadScript(turnSetProbeScript(fieldMonsterCode), "light-intervention-turn-set-probe.lua");
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredLock.host.messages).toContain("light of intervention turn set false/false/true");
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
      e:SetOperation(function(e,tp) Debug.Message("light of intervention responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function turnSetProbeScript(fieldMonsterCode: string): string {
  return `
    local monster=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fieldMonsterCode}),0,0,LOCATION_MZONE,nil)
    Debug.Message(
      "light of intervention turn set " ..
      tostring(monster:IsCanTurnSet()) .. "/" ..
      tostring(monster:IsCanChangePosition(POS_FACEDOWN_DEFENSE)) .. "/" ..
      tostring(monster:IsCanChangePosition(POS_FACEUP_DEFENSE))
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
