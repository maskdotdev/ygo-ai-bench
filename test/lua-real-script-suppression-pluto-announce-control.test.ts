import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const plutoCode = "24413299";
const declaredCode = "75505728";
const targetCode = "24413300";
const responderCode = "24413301";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script The Suppression Pluto announce control", () => {
  it("restores announced opponent hand confirmation into the selected GetControl branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${plutoCode}.lua`);
    expect(script).toContain("Duel.AnnounceCard(tp,s.announce_filter)");
    expect(script).toContain("Duel.ConfirmCards(tp,g)");
    expect(script).toContain("Duel.SelectEffect(tp,{#g1>0,aux.Stringid(id,1)},{#g2>0,aux.Stringid(id,2)})");
    expect(script).toContain("Duel.GetControl(tc,tp)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === plutoCode),
      { code: declaredCode, name: "Declared Opponent Hand Card", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000 },
      { code: targetCode, name: "Control-Change Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
      { code: responderCode, name: "Pluto Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 24413299, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [plutoCode] }, 1: { main: [declaredCode, targetCode, responderCode] } });
    startDuel(session);

    const pluto = requireCard(session, plutoCode);
    const declared = requireCard(session, declaredCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, pluto.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, declared.uid, "hand", 1);
    moveDuelCard(session.state, target.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(plutoCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === pluto.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, activation!);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x20000000, targetUids: [], count: 0, player: 0, parameter: 0x8 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);

    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "AnnounceCard", player: 0, options: [declaredCode].map(Number), descriptions: [declaredCode].map(Number), returned: Number(declaredCode) },
      { id: "lua-prompt-2", api: "SelectEffect", player: 0, options: [1], descriptions: [390612785], returned: 1 },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === declared.uid)).toMatchObject({
      location: "hand",
      controller: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonCardUid: pluto.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.eventHistory.filter((event) => ["confirmed", "controlChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: declared.uid,
        eventPlayer: 0,
        eventValue: 2,
        eventUids: [declared.uid, responder.uid],
        eventReason: 0,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pluto.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
    expect(restored.host.messages).not.toContain("pluto responder resolved");

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
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
      e:SetOperation(function(e,tp) Debug.Message("pluto responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
