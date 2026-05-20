import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const preparationCode = "96729612";
const ritualMonsterCode = "967296120";
const ritualSpellCode = "967296121";
const highLevelDecoyCode = "967296122";
const nonRitualDecoyCode = "967296123";
const responderCode = "967296124";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeRitual = 0x80;
const raceSpellcaster = 0x10;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Preparation of Rites optional grave search", () => {
  it("restores Deck ritual monster search, optional Graveyard ritual spell retrieval, and SelectYesNo prompt", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${preparationCode}.lua`);
    expect(script).toContain("return c:IsRitualMonster() and c:IsLevelBelow(7) and c:IsAbleToHand()");
    expect(script).toContain("return c:IsRitualSpell() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_GRAVE)");
    expect(script).toContain("Duel.GetMatchingGroup(aux.NecroValleyFilter(s.filter2),tp,LOCATION_GRAVE,0,nil)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,0))");
    expect(script).toContain("Duel.BreakEffect()");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === preparationCode),
      { code: ritualMonsterCode, name: "Preparation Ritual Monster", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, race: raceSpellcaster, attribute: attributeLight, level: 6, attack: 2000, defense: 2000 },
      { code: ritualSpellCode, name: "Preparation Ritual Spell", kind: "spell", typeFlags: typeSpell | typeRitual },
      { code: highLevelDecoyCode, name: "Preparation High Level Ritual Decoy", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, race: raceSpellcaster, attribute: attributeLight, level: 8, attack: 2500, defense: 2500 },
      { code: nonRitualDecoyCode, name: "Preparation Non-Ritual Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 6, attack: 1800, defense: 1800 },
      { code: responderCode, name: "Preparation Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 96729612, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [preparationCode, ritualMonsterCode, ritualSpellCode, highLevelDecoyCode, nonRitualDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const preparation = requireCard(session, preparationCode);
    const ritualMonster = requireCard(session, ritualMonsterCode);
    const ritualSpell = requireCard(session, ritualSpellCode);
    const highLevelDecoy = requireCard(session, highLevelDecoyCode);
    const nonRitualDecoy = requireCard(session, nonRitualDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, preparation.uid, "hand", 0);
    moveDuelCard(session.state, ritualSpell.uid, "graveyard", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(preparationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === preparation.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: preparation.uid,
        player: 0,
        effectId: "lua-1-1002",
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
        possibleOperationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x10 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: "SelectYesNo", player: 0, returned: true }),
    ]));
    expect(restoredChain.host.messages).not.toContain("preparation responder resolved");
    expect(restoredChain.host.messages).toContain(`confirmed 1: ${ritualMonsterCode}`);
    expect(restoredChain.host.messages).toContain(`confirmed 1: ${ritualSpellCode}`);
    expect(restoredChain.session.state.cards.find((card) => card.uid === preparation.uid)).toMatchObject({ location: "graveyard", reason: duelReason.rule, reasonPlayer: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === ritualMonster.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: preparation.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === ritualSpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: preparation.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === highLevelDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === nonRitualDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["sentToGraveyard", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      sentToHandEvent(ritualMonster.uid, preparation.uid, { location: "deck", sequence: 0, faceUp: false }, 0),
      confirmedEvent(ritualMonster.uid, preparation.uid, { location: "deck", sequence: 0, faceUp: false }, 0),
      sentToHandConfirmedEvent(ritualMonster.uid, preparation.uid, { location: "deck", sequence: 0, faceUp: false }, 0),
      sentToHandEvent(ritualSpell.uid, preparation.uid, { location: "graveyard", sequence: 0, faceUp: true }, 1),
      confirmedEvent(ritualSpell.uid, preparation.uid, { location: "graveyard", sequence: 0, faceUp: true }, 1),
      sentToHandConfirmedEvent(ritualSpell.uid, preparation.uid, { location: "graveyard", sequence: 0, faceUp: true }, 1),
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: preparation.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function sentToHandEvent(cardUid: string, sourceUid: string, previous: { location: "deck" | "graveyard"; sequence: number; faceUp: boolean }, handSequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: previous.faceUp, location: previous.location, position: "faceDown", sequence: previous.sequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: handSequence },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, previous: { location: "deck" | "graveyard"; sequence: number; faceUp: boolean }, handSequence: number) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: previous.faceUp, location: previous.location, position: "faceDown", sequence: previous.sequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: handSequence },
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, previous: { location: "deck" | "graveyard"; sequence: number; faceUp: boolean }, handSequence: number) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: previous.faceUp, location: previous.location, position: "faceDown", sequence: previous.sequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: handSequence },
  };
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor;
  expect(player).toBeDefined();
  const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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
      e:SetOperation(function(e,tp) Debug.Message("preparation responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
