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
const forcesCode = "29826127";
const hasForcesScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${forcesCode}.lua`));
const darkWorldOneCode = "29826128";
const darkWorldTwoCode = "29826129";
const offSetMonsterCode = "29826130";
const darkWorldSpellCode = "29826131";
const responderCode = "29826132";
const typeMonster = 0x1;
const typeSpell = 0x2;
const setDarkWorld = 0x6;

describe.skipIf(!hasUpstreamScripts || !hasForcesScript)("Lua real script The Forces of Darkness grave to hand", () => {
  it("restores targeted Dark World Graveyard monsters from CHAININFO and confirms them to hand", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${forcesCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsSetCard(SET_DARK_WORLD) and c:IsMonster() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,2,2,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,g,2,0,0)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
    expect(script).toContain("g:Filter(Card.IsRelateToEffect,nil,e)");
    expect(script).toContain("Duel.SendtoHand(sg,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,sg)");

    const cards: DuelCardData[] = [
      { code: forcesCode, name: "The Forces of Darkness", kind: "spell", typeFlags: typeSpell },
      { code: darkWorldOneCode, name: "Dark World Grave Target A", kind: "monster", typeFlags: typeMonster, level: 4, setcodes: [setDarkWorld] },
      { code: darkWorldTwoCode, name: "Dark World Grave Target B", kind: "monster", typeFlags: typeMonster, level: 4, setcodes: [setDarkWorld] },
      { code: offSetMonsterCode, name: "Off-Set Grave Decoy", kind: "monster", typeFlags: typeMonster, level: 4, setcodes: [0x123] },
      { code: darkWorldSpellCode, name: "Dark World Spell Decoy", kind: "spell", typeFlags: typeSpell, setcodes: [setDarkWorld] },
      { code: responderCode, name: "Forces of Darkness Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 29826127, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [forcesCode, darkWorldOneCode, darkWorldTwoCode, offSetMonsterCode, darkWorldSpellCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const forces = requireCard(session, forcesCode);
    const darkWorldOne = requireCard(session, darkWorldOneCode);
    const darkWorldTwo = requireCard(session, darkWorldTwoCode);
    const offSetMonster = requireCard(session, offSetMonsterCode);
    const darkWorldSpell = requireCard(session, darkWorldSpellCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, forces.uid, "hand", 0);
    moveDuelCard(session.state, darkWorldOne.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(session.state, darkWorldTwo.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(session.state, offSetMonster.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(session.state, darkWorldSpell.uid, "graveyard", 0).faceUp = true;
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
    expect(host.loadCardScript(Number(forcesCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === forces.uid);
    expect(action, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x8, targetUids: [darkWorldOne.uid, darkWorldTwo.uid], count: 2, player: 0, parameter: 0 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]?.targetUids).toEqual([darkWorldOne.uid, darkWorldTwo.uid]);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x8, targetUids: [darkWorldOne.uid, darkWorldTwo.uid], count: 2, player: 0, parameter: 0 },
    ]);
    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);

    expect(restored.session.state.cards.find((card) => card.uid === forces.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === darkWorldOne.uid)).toMatchObject({ location: "hand", controller: 0, reason: duelReason.effect });
    expect(restored.session.state.cards.find((card) => card.uid === darkWorldTwo.uid)).toMatchObject({ location: "hand", controller: 0, reason: duelReason.effect });
    expect(restored.session.state.cards.find((card) => card.uid === offSetMonster.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === darkWorldSpell.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      sentToHandEvent(darkWorldOne.uid, forces.uid, 0),
      sentToHandEvent(darkWorldTwo.uid, forces.uid, 1),
      { ...sentToHandEvent(darkWorldOne.uid, forces.uid, 0), eventUids: [darkWorldOne.uid, darkWorldTwo.uid] },
      confirmedEvent("confirmed", darkWorldOne.uid, forces.uid),
      confirmedEvent("sentToHandConfirmed", darkWorldOne.uid, forces.uid),
    ]);
    expect(restored.host.messages).not.toContain("forces of darkness responder resolved");
  });
});

function sentToHandEvent(cardUid: string, sourceUid: string, sequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence },
  };
}

function confirmedEvent(eventName: "confirmed" | "sentToHandConfirmed", cardUid: string, sourceUid: string) {
  return {
    eventName,
    eventCode: eventName === "confirmed" ? 1211 : 1212,
    eventPlayer: 1,
    eventUids: [cardUid, "p0-deck-29826129-2"],
    eventValue: 2,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
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
      e:SetOperation(function(e,tp) Debug.Message("forces of darkness responder resolved") end)
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
