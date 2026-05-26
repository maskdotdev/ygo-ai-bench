import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const karmaCode = "9659580";
const vijamCode = "15610297";
const cubicAllyCode = "965958001";
const cubicSearchCode = "965958002";
const cubicSummonerCode = "965958003";
const responderCode = "965958004";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasKarmaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${karmaCode}.lua`));
const setCubic = 0xe3;
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFiend = 0x8;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasKarmaScript)("Lua real script Cubic Karma activation trigger search stat", () => {
  it("restores activation Vijam sends into ATK gain, opponent-turn LP trigger, and grave SelfBanish search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${karmaCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_HAND|LOCATION_DECK,0,1,99,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("Duel.SetLP(1-tp,math.ceil(Duel.GetLP(1-tp)/2))");
    expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [karmaCode, vijamCode].includes(card.code)),
      cubicMonster(cubicAllyCode, "Cubic Karma ATK Target", 1000, 1000),
      cubicMonster(cubicSearchCode, "Cubic Karma Search Target", 1500, 1200),
      cubicMonster(cubicSummonerCode, "Cubic Karma Summoner", 1200, 800),
      { code: responderCode, name: "Cubic Karma Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${cubicSummonerCode}.lua`) return cubicSummonerScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const text = workspace.readScript(name);
        if (text === undefined) throw new Error(`missing script ${name}`);
        return text;
      },
    };

    const restoredActivate = createRestoredKarmaDuel({ reader, workspace, source, mode: "activate" });
    expectCleanRestore(restoredActivate);
    expectRestoredLegalActions(restoredActivate, 0);
    const activatingKarma = requireCard(restoredActivate.session, karmaCode);
    const activatedAlly = requireCard(restoredActivate.session, cubicAllyCode);
    const activation = getLuaRestoreLegalActions(restoredActivate, 0).find((action) => action.type === "activateEffect" && action.uid === activatingKarma.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivate, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivate, activation!);
    expect(restoredActivate.host.promptDecisions).toContainEqual({ id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 154553282, returned: true });
    expect(restoredActivate.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: activatingKarma.uid,
        player: 0,
        effectId: "lua-1-1002",
        activationLocation: "hand",
        activationSequence: 0,
        targetUids: [activatedAlly.uid],
        targetFieldIds: [8],
        operationInfos: [{ category: 0x20, targetUids: [], count: 1, player: 0, parameter: 1 }],
      },
    ]);
    expectRestoredLegalActions(restoredActivate, 1);
    expect(getLuaRestoreLegalActions(restoredActivate, 1).some((action) => action.type === "activateEffect" && action.uid === requireCard(restoredActivate.session, responderCode).uid)).toBe(true);
    passRestoredChain(restoredActivate);
    const firstVijam = requireCard(restoredActivate.session, vijamCode, 0);
    const secondVijam = requireCard(restoredActivate.session, vijamCode, 1);
    expect(restoredActivate.session.state.cards.find((card) => card.uid === activatingKarma.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });
    expect(restoredActivate.session.state.cards.find((card) => card.uid === firstVijam.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: activatingKarma.uid,
      reasonEffectId: 1,
    });
    expect(restoredActivate.session.state.cards.find((card) => card.uid === secondVijam.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: activatingKarma.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(activatedAlly, restoredActivate.session.state)).toBe(2600);
    expect(restoredActivate.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredActivate.host.messages).not.toContain("cubic karma responder resolved");

    const restoredTrigger = createRestoredKarmaDuel({ reader, workspace, source, mode: "trigger" });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const summoner = requireCard(restoredTrigger.session, cubicSummonerCode);
    const summonVijam = requireCard(restoredTrigger.session, vijamCode);
    const summon = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateEffect" && action.uid === summoner.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, summon!);
    passRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === summonVijam.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summoner.uid,
      reasonEffectId: 4,
    });
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === requireCard(restoredTrigger.session, karmaCode).uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === requireCard(restoredTrigger.session, karmaCode).uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: requireCard(restoredTrigger.session, karmaCode).uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.players[1].lifePoints).toBe(4000);

    const restoredSearch = createRestoredKarmaDuel({ reader, workspace, source, mode: "search" });
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const graveKarma = requireCard(restoredSearch.session, karmaCode);
    const searchTarget = requireCard(restoredSearch.session, cubicSearchCode);
    const search = getLuaRestoreLegalActions(restoredSearch, 0).find((action) => action.type === "activateEffect" && action.uid === graveKarma.uid);
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSearch, search!);
    expect(restoredSearch.session.state.cards.find((card) => card.uid === graveKarma.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveKarma.uid,
      reasonEffectId: 3,
    });
    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveKarma.uid,
      reasonEffectId: 3,
    });
    expect(restoredSearch.host.messages).toContain(`confirmed 1: ${cubicSearchCode}`);
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["banished", "sentToHand", "confirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: graveKarma.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveKarma.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: searchTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveKarma.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: searchTarget.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [searchTarget.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveKarma.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function cubicMonster(code: string, name: string, attack: number, defense: number): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect,
    level: 4,
    attack,
    defense,
    race: raceFiend,
    attribute: attributeDark,
    setcodes: [setCubic],
  };
}

function createRestoredKarmaDuel({
  reader,
  workspace,
  source,
  mode,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  source: { readScript(name: string): string };
  mode: "activate" | "trigger" | "search";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: `9659580-${mode}`, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: mode === "activate" ? [karmaCode, cubicAllyCode, vijamCode, vijamCode, cubicSearchCode] : mode === "trigger" ? [karmaCode, vijamCode, cubicSearchCode, cubicSummonerCode] : [karmaCode, vijamCode, cubicSearchCode] },
    1: { main: [responderCode] },
  });
  startDuel(session);
  const karma = requireCard(session, karmaCode);
  if (mode === "activate") {
    moveDuelCard(session.state, karma.uid, "hand", 0);
    moveFaceUpAttack(session, requireCard(session, cubicAllyCode), 0);
    moveDuelCard(session.state, requireCard(session, vijamCode, 0).uid, "hand", 0);
    setDeckSequence(requireCard(session, vijamCode, 1), 0);
    setDeckSequence(requireCard(session, cubicSearchCode), 1);
    moveDuelCard(session.state, requireCard(session, responderCode).uid, "hand", 1);
    session.state.turnPlayer = 0;
  } else if (mode === "trigger") {
    moveDuelCard(session.state, karma.uid, "spellTrapZone", 0);
    karma.faceUp = true;
    moveFaceUpAttack(session, requireCard(session, cubicSummonerCode), 0);
    moveDuelCard(session.state, requireCard(session, vijamCode).uid, "hand", 0);
    session.state.turnPlayer = 1;
  } else {
    moveDuelCard(session.state, karma.uid, "graveyard", 0).faceUp = true;
    setDeckSequence(requireCard(session, cubicSearchCode), 1);
    moveDuelCard(session.state, requireCard(session, vijamCode).uid, "graveyard", 0);
    session.state.turnPlayer = 0;
  }
  session.state.phase = "main1";
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(karmaCode), source).ok).toBe(true);
  if (mode === "trigger") expect(host.loadCardScript(Number(cubicSummonerCode), source).ok).toBe(true);
  if (mode === "activate") expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(mode === "trigger" || mode === "activate" ? 2 : 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
}

function cubicSummonerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0
          and Duel.IsExistingMatchingCard(Card.IsCode,tp,LOCATION_HAND,0,1,nil,${vijamCode}) end
        Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)
      end)
      e:SetOperation(function(e,tp)
        local g=Duel.SelectMatchingCard(tp,Card.IsCode,tp,LOCATION_HAND,0,1,1,nil,${vijamCode})
        if #g>0 then Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP_ATTACK) end
      end)
      c:RegisterEffect(e)
    end
  `;
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
      e:SetOperation(function(e,tp) Debug.Message("cubic karma responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string, index = 0): DuelCardInstance {
  const cards = session.state.cards.filter((candidate) => candidate.code === code);
  expect(cards[index]).toBeDefined();
  return cards[index]!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
}
