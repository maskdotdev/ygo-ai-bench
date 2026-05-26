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
const arrowsylphCode = "31118030";
const deckRitualSpellCode = "31118031";
const graveRitualSpellCode = "31118032";
const normalSpellDecoyCode = "31118033";
const responderCode = "31118034";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeRitual = 0x80;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Prediction Princess Arrowsylph flip NecroValley search", () => {
  it("restores delayed FLIP NecroValleyFilter Ritual Spell Deck-or-Graveyard search and confirmation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${arrowsylphCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
    expect(script).toContain("return c:IsRitualSpell() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK|LOCATION_GRAVE)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.thfilter),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === arrowsylphCode),
      { code: deckRitualSpellCode, name: "Arrowsylph Deck Ritual Spell Target", kind: "spell", typeFlags: typeSpell | typeRitual },
      { code: graveRitualSpellCode, name: "Arrowsylph Grave Ritual Spell Target", kind: "spell", typeFlags: typeSpell | typeRitual },
      { code: normalSpellDecoyCode, name: "Arrowsylph Normal Spell Decoy", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Arrowsylph Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 31118030, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [arrowsylphCode, deckRitualSpellCode, graveRitualSpellCode, normalSpellDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const arrowsylph = requireCard(session, arrowsylphCode);
    const deckRitualSpell = requireCard(session, deckRitualSpellCode);
    const graveRitualSpell = requireCard(session, graveRitualSpellCode);
    const normalSpellDecoy = requireCard(session, normalSpellDecoyCode);
    const responder = requireCard(session, responderCode);
    const movedArrowsylph = moveDuelCard(session.state, arrowsylph.uid, "monsterZone", 0);
    movedArrowsylph.position = "faceDownDefense";
    movedArrowsylph.faceUp = false;
    moveDuelCard(session.state, graveRitualSpell.uid, "graveyard", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const text = workspace.readScript(name);
        if (text === undefined) throw new Error(`Missing script ${name}`);
        return text;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(arrowsylphCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const flip = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "flipSummon" && action.uid === arrowsylph.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, flip!);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        player: 0,
        id: "trigger-3-1",
        effectId: "lua-1",
        sourceUid: arrowsylph.uid,
        triggerBucket: "turnMandatory",
        eventName: "flipSummoned",
        eventCode: 1001,
        eventCardUid: arrowsylph.uid,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === arrowsylph.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        sourceUid: arrowsylph.uid,
        player: 0,
        effectId: "lua-1",
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "flipSummoned",
        eventCode: 1001,
        eventCardUid: arrowsylph.uid,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x11 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass?.windowKind).toBe("chainResponse");
    applyLuaRestoreAndAssert(restoredChain, pass!);

    const searchedTargets = [deckRitualSpell, graveRitualSpell].filter((card) =>
      restoredChain.session.state.cards.find((candidate) => candidate.uid === card.uid)?.location === "hand"
    );
    expect(searchedTargets).toHaveLength(1);
    const searched = searchedTargets[0]!;
    const searchedPreviousLocation = searched.uid === deckRitualSpell.uid ? "deck" : "graveyard";
    expect(restoredChain.session.state.cards.find((card) => card.uid === arrowsylph.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === normalSpellDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChain.host.messages).toEqual([`confirmed 1: ${searched.code}`]);
    expect(restoredChain.host.messages).not.toContain("arrowsylph responder resolved");
    expect(
      restoredChain.session.state.eventHistory.filter((event) =>
        ["flipSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName),
      ),
    ).toEqual([
      {
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: arrowsylph.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      sentToHandEvent(searched.uid, arrowsylph.uid, searchedPreviousLocation),
      confirmedEvent(searched.uid, arrowsylph.uid, searchedPreviousLocation),
      sentToHandConfirmedEvent(searched.uid, arrowsylph.uid, searchedPreviousLocation),
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

function sentToHandEvent(cardUid: string, sourceUid: string, previousLocation: "deck" | "graveyard") {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: expect.objectContaining({ controller: 0, location: previousLocation }),
    eventCurrentState: expect.objectContaining({ controller: 0, location: "hand" }),
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, previousLocation: "deck" | "graveyard") {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventUids: [cardUid],
    eventValue: 1,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: expect.objectContaining({ controller: 0, location: previousLocation }),
    eventCurrentState: expect.objectContaining({ controller: 0, location: "hand" }),
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, previousLocation: "deck" | "graveyard") {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventUids: [cardUid],
    eventValue: 1,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: expect.objectContaining({ controller: 0, location: previousLocation }),
    eventCurrentState: expect.objectContaining({ controller: 0, location: "hand" }),
  };
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
      e:SetOperation(function(e,tp) Debug.Message("arrowsylph responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
