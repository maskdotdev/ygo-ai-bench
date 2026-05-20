import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeTrap = 0x4;
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Trap Reclamation activated Trap return", () => {
  it("restores discard-cost chaining to a Trap activation and returns that Trap from Graveyard to hand", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const reclamationCode = "2122975";
    const starterTrapCode = "212297501";
    const discardCode = "212297502";
    const script = workspace.readScript(`c${reclamationCode}.lua`);
    expect(script).toContain("return rp==tp and re:IsHasType(EFFECT_TYPE_ACTIVATE) and re:IsTrapEffect()");
    expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD,nil)");
    expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("Duel.SendtoHand(e:GetHandler(),tp,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === reclamationCode),
      { code: starterTrapCode, name: "Trap Reclamation Starter Trap", kind: "trap", typeFlags: typeTrap },
      { code: discardCode, name: "Trap Reclamation Discard Cost", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2122, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [reclamationCode, starterTrapCode, discardCode] }, 1: { main: [] } });
    startDuel(session);

    const reclamation = requireCard(session, reclamationCode);
    const starterTrap = requireCard(session, starterTrapCode);
    const discard = requireCard(session, discardCode);
    moveDuelCard(session.state, reclamation.uid, "spellTrapZone", 0).faceUp = false;
    moveDuelCard(session.state, starterTrap.uid, "spellTrapZone", 0).faceUp = false;
    moveDuelCard(session.state, discard.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterTrapCode}.lua`) return starterTrapScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(reclamationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterTrapCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const starter = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === starterTrap.uid);
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, starter!);
    expect(restoredOpen.session.state.chain).toHaveLength(1);
    expect(restoredOpen.session.state.chain[0]?.operationInfos).toBeUndefined();

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    expect(restoredResponse.session.state.waitingFor).toBe(0);
    const chainReclamation = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === reclamation.uid);
    expect(chainReclamation, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, chainReclamation!);
    expect(restoredResponse.session.state.chain[1]?.operationInfos).toBeUndefined();
    expect(restoredResponse.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredResponse.session.state.eventHistory.filter((event) => event.eventName === "discarded" && event.eventCardUid === discard.uid)).toHaveLength(1);

    resolveRestoredChain(restoredResponse);
    expect(restoredResponse.session.state.cards.find((card) => card.uid === starterTrap.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === reclamation.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredResponse.session.state.eventHistory.some((event) => event.eventName === "sentToHand" && event.eventCardUid === starterTrap.uid)).toBe(true);

    const restoredReturned = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), source, reader);
    expectCleanRestore(restoredReturned);
    expectRestoredLegalActions(restoredReturned, 0);
    expect(restoredReturned.session.state.cards.find((card) => card.uid === starterTrap.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredReturned.host.messages).not.toContain("trap reclamation starter resolved twice");
  });
});

function starterTrapScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp)
        Debug.Message("trap reclamation starter resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    passChain(restored, player);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLegalActions(restored.session, waitingFor));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
