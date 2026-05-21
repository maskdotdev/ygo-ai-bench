import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const ancientCloakCode = "90432163";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAncientCloakScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ancientCloakCode}.lua`));
const darkTargetCode = "904321630";
const searchCode = "904321631";
const offSetCode = "904321632";
const responderCode = "904321633";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setPhantomKnights = 0x10db;

describe.skipIf(!hasUpstreamScripts || !hasAncientCloakScript)("Lua real script Phantom Knights Ancient Cloak position stat search", () => {
  it("restores self position change into DARK target stat boost and grave self-banish Phantom Knights search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ancientCloakCode}.lua`);
    expect(script).toContain("return e:GetHandler():IsPosition(POS_FACEUP_ATTACK)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.ChangePosition(c,POS_FACEUP_DEFENSE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END|RESET_OPPO_TURN)");
    expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
    expect(script).toContain("return c:IsSetCard(SET_THE_PHANTOM_KNIGHTS) and not c:IsCode(id) and c:IsAbleToHand()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      { code: ancientCloakCode, name: "The Phantom Knights of Ancient Cloak", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 3, attack: 800, defense: 1000, setcodes: [setPhantomKnights] },
      { code: darkTargetCode, name: "Ancient Cloak DARK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 900 },
      { code: searchCode, name: "Ancient Cloak Phantom Knights Search", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 3, attack: 1000, defense: 1000, setcodes: [setPhantomKnights] },
      { code: offSetCode, name: "Ancient Cloak Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 3, attack: 1000, defense: 1000, setcodes: [0x123] },
      { code: responderCode, name: "Ancient Cloak Chain Responder", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 90432163, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ancientCloakCode, darkTargetCode, searchCode, offSetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const cloak = requireCard(session, ancientCloakCode);
    const darkTarget = requireCard(session, darkTargetCode);
    const search = requireCard(session, searchCode);
    const offSet = requireCard(session, offSetCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, cloak, 0);
    moveFaceUpAttack(session, darkTarget, 1);
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
    expect(host.loadCardScript(Number(ancientCloakCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const statAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === cloak.uid && action.effectId === "lua-1");
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, statAction!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: cloak.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetUids: [cloak.uid],
      },
    ]);
    expect(getLuaRestoreLegalActions(restoredOpen, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === cloak.uid)).toMatchObject({ location: "monsterZone", position: "faceUpDefense", faceUp: true });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === cloak.uid), restoredOpen.session.state)).toBe(1600);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === cloak.uid), restoredOpen.session.state)).toBe(1800);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === cloak.uid && [100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, controller: 0, event: "continuous", property: 0x400, range: ["monsterZone"], reset: { flags: 1644040704 }, value: 800 },
      { code: 104, controller: 0, event: "continuous", property: 0x400, range: ["monsterZone"], reset: { flags: 1644040704 }, value: 800 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "positionChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: cloak.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: cloak.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cloak.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);

    moveDuelCard(restoredOpen.session.state, cloak.uid, "graveyard", 0);
    cloak.location = "graveyard";
    cloak.controller = 0;
    cloak.position = "faceUpAttack";
    cloak.faceUp = true;
    restoredOpen.session.state.waitingFor = 0;
    const restoredGrave = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredGrave);
    expectRestoredLegalActions(restoredGrave, 0);
    const searchAction = getLuaRestoreLegalActions(restoredGrave, 0).find((action) => action.type === "activateEffect" && action.uid === cloak.uid && action.effectId === "lua-2");
    expect(searchAction, JSON.stringify(getLuaRestoreLegalActions(restoredGrave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGrave, searchAction!);
    expect(restoredGrave.session.state.chain).toEqual([
      {
        id: "chain-6",
        chainIndex: 1,
        effectId: "lua-2",
        sourceUid: cloak.uid,
        player: 0,
        activationLocation: "graveyard",
        activationSequence: 0,
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
      },
    ]);
    expect(restoredGrave.session.state.cards.find((card) => card.uid === cloak.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: cloak.uid,
      reasonEffectId: 2,
    });
    resolveRestoredChain(restoredGrave);
    expect(restoredGrave.host.messages).toContain(`confirmed 1: ${searchCode}`);
    expect(restoredGrave.session.state.cards.find((card) => card.uid === search.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: cloak.uid,
      reasonEffectId: 2,
    });
    expect(restoredGrave.session.state.cards.find((card) => card.uid === offSet.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredGrave.session.state.eventHistory.filter((event) => ["banished", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: cloak.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: cloak.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpDefense", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpDefense", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: search.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cloak.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: search.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [search.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cloak.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: search.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [search.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cloak.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
      e:SetOperation(function(e,tp) Debug.Message("ancient cloak responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
