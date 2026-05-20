import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
const apocavitiesCode = "28531163";
const cariesCounter = 0x215;
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Apocavities counter SelectEffect", () => {
  it("restores placed counters and selected counter-cost destroy branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const targetCode = "285311630";
    const decoyACode = "285311631";
    const decoyBCode = "285311632";
    const decoyCCode = "285311633";
    const responderCode = "285311634";
    const script = workspace.readScript(`c${apocavitiesCode}.lua`);
    expect(script).toContain("c:EnableCounterPermit(COUNTER_CARIES)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e:GetHandler():AddCounter(COUNTER_CARIES,Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD))");
    expect(script).toContain("Duel.SelectEffect(tp,");
    expect(script).toContain("Duel.RemoveCounter(tp,1,1,COUNTER_CARIES,ct,REASON_COST)");
    expect(script).toContain("e:SetLabel(ct)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,tc,1,tp,0)");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === apocavitiesCode),
      { code: targetCode, name: "Apocavities Destroy Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000 },
      { code: decoyACode, name: "Apocavities Field Decoy A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: decoyBCode, name: "Apocavities Field Decoy B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1100, defense: 1000 },
      { code: decoyCCode, name: "Apocavities Field Decoy C", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Apocavities Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 28531163, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [apocavitiesCode] }, 1: { main: [targetCode, decoyACode, decoyBCode, decoyCCode, responderCode] } });
    startDuel(session);

    const apocavities = requireCard(session, apocavitiesCode);
    const target = requireCard(session, targetCode);
    const decoyA = requireCard(session, decoyACode);
    const decoyB = requireCard(session, decoyBCode);
    const decoyC = requireCard(session, decoyCCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, apocavities.uid, "spellTrapZone", 0);
    apocavities.faceUp = true;
    apocavities.counters = { [cariesCounter]: 4 };
    for (const card of [target, decoyA, decoyB, decoyC]) {
      moveDuelCard(session.state, card.uid, "monsterZone", 1).position = "faceUpAttack";
    }
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace, { promptOverrides: [{ api: "SelectEffect", player: 0, returned: 4 }] });
    expect(host.loadCardScript(Number(apocavitiesCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredIgnitionWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredIgnitionWindow);
    expectRestoredLegalActions(restoredIgnitionWindow, 0);
    expect(restoredIgnitionWindow.session.state.cards.find((card) => card.uid === apocavities.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      counters: { [cariesCounter]: 4 },
    });

    const ignition = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === apocavities.uid);
    expect(ignition, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, ignition!);
    expect(host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        api: "SelectEffect",
        player: 0,
        options: [1, 2, 3, 4],
        returned: 4,
      }),
    ]));
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-3",
        sourceUid: apocavities.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        effectLabel: 4,
        targetUids: [target.uid],
        operationInfos: [{ category: 0x1, count: 1, parameter: 0, player: 0, targetUids: [target.uid] }],
      },
    ]);
    expect(session.state.cards.find((card) => card.uid === apocavities.uid)?.counters?.[cariesCounter] ?? 0).toBe(0);

    const restoredDestroyChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredDestroyChain);
    expectRestoredLegalActions(restoredDestroyChain, 1);
    passChain(restoredDestroyChain, 1);
    expect(restoredDestroyChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: apocavities.uid,
      reasonEffectId: 3,
    });
    for (const decoy of [decoyA, decoyB, decoyC]) {
      expect(restoredDestroyChain.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    }
    expect(restoredDestroyChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === target.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: apocavities.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredDestroyChain.host.messages).not.toContain("apocavities responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("apocavities responder resolved") end)
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
  const response = applyLuaRestoreResponse(restored, pass!);
  expect(response.ok, response.error).toBe(true);
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
}
