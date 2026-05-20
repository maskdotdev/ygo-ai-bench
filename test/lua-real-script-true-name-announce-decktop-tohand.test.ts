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
const trueNameCode = "39913299";
const hasTrueNameScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${trueNameCode}.lua`));
const declaredTopCode = "75505728";
const divineCode = "101";
const fillerCode = "102";
const responderCode = "103";
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeDivine = 0x40;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasTrueNameScript)("Lua real script The True Name Deck-top announce", () => {
  it("restores AnnounceCard, Deck-top confirmation, top-card search, and aux.ToHandOrElse follow-up", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${trueNameCode}.lua`);
    expect(script).toContain("Duel.AnnounceCard(tp,table.unpack(s.announce_filter))");
    expect(script).toContain("Duel.ConfirmDecktop(tp,1)");
    expect(script).toContain("Duel.GetDecktopGroup(tp,1):GetFirst()");
    expect(script).toContain("aux.ToHandOrElse(sc,tp,");
    expect(script).toContain("Duel.ShuffleDeck(tp)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === trueNameCode),
      { code: declaredTopCode, name: "Declared Top Card", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000 },
      { code: divineCode, name: "Divine Follow-Up Monster", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeDivine, level: 10, attack: 3000, defense: 3000 },
      { code: fillerCode, name: "Deck Filler", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "True Name Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 39913299, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [trueNameCode, declaredTopCode, divineCode, fillerCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const trueName = requireCard(session, trueNameCode);
    const declaredTop = requireCard(session, declaredTopCode);
    const divine = requireCard(session, divineCode);
    const filler = requireCard(session, fillerCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, trueName.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    setDeckSequence(declaredTop, 0);
    setDeckSequence(divine, 1);
    setDeckSequence(filler, 2);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(trueNameCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === trueName.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, activation!);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x20000000, targetUids: [], count: 0, player: 0, parameter: 0x8 },
    ]);
    expect(restored.session.state.chain[0]?.possibleOperationInfos).toEqual([
      { category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 },
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "AnnounceCard", player: 0, options: [75505728], descriptions: [75505728], returned: 75505728 },
      { id: "lua-prompt-2", api: "SelectYesNo", player: 0, description: 638612785, returned: true },
      { id: "lua-prompt-3", api: "SelectOption", player: 0, options: [0, 1], descriptions: [573, 638612787], returned: 0 },
    ]);
    expect(restored.host.messages).toContain(`confirmed decktop 0: ${declaredTopCode}`);
    expect(restored.session.state.shuffleCheckDisabled).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === declaredTop.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: trueName.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === divine.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: trueName.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === filler.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => ["confirmed", "sentToHand", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: declaredTop.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [declaredTop.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: declaredTop.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: trueName.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: divine.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: trueName.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: divine.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [divine.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: trueName.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: divine.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [divine.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: trueName.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
    ]);
    expect(restored.host.messages).not.toContain("true name responder resolved");

    expect(restored.host.messages).not.toContain("true name responder resolved");

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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
      e:SetOperation(function(e,tp) Debug.Message("true name responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function setDeckSequence(card: DuelCardInstance, sequence: number): void {
  card.location = "deck";
  card.controller = 0;
  card.sequence = sequence;
  card.faceUp = false;
  card.position = "faceDown";
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
