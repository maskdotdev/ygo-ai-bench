import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const youAiCode = "32056070";
const lightCyberseCode = "320560700";
const darkCyberseCode = "320560701";
const summonerCode = "320560702";
const tokenIgnisterCode = "11738490";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typesToken = 0x4011;
const raceCyberse = 0x1000000;
const attributeLight = 0x10;
const attributeDark = 0x20;
const setIgnister = 0x135;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script You and A.I. custom token disable", () => {
  it("restores SPSUMMON_SUCCESS custom trigger into field disable and Ignister Token summon branches", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${youAiCode}.lua`);
    expectScriptShape(script);

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === youAiCode),
      { code: lightCyberseCode, name: "You and A.I. Light Cyberse", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 2300, defense: 1000 },
      { code: darkCyberseCode, name: "You and A.I. Dark Cyberse", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 2300, defense: 1000 },
      { code: summonerCode, name: "You and A.I. Branch Summoner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
      { code: tokenIgnisterCode, name: "@Ignister Token", kind: "monster", typeFlags: typesToken, race: raceCyberse, attribute: attributeDark, level: 1, attack: 0, defense: 0, setcodes: [setIgnister] },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${summonerCode}.lua`) return branchSummonerScript();
        return workspace.readScript(name);
      },
    };

    const disableSession = createSession(reader, lightCyberseCode, [youAiCode, lightCyberseCode, summonerCode], []);
    const disableYouAi = requireCard(disableSession, youAiCode);
    const disableSummoner = requireCard(disableSession, summonerCode);
    const disableCyberse = requireCard(disableSession, lightCyberseCode);
    setupField(disableSession, disableYouAi, disableSummoner);
    register(disableSession, workspace, source);

    const restoredDisableOpen = restoreDuelWithLuaScripts(serializeDuel(disableSession), source, reader);
    expectCleanRestore(restoredDisableOpen);
    expectRestoredLegalActions(restoredDisableOpen, 0);
    activateAndResolve(restoredDisableOpen, disableSummoner.uid, 0);
    expect(restoredDisableOpen.session.state.cards.find((card) => card.uid === disableCyberse.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: disableSummoner.uid,
      reasonEffectId: 5,
    });

    const restoredDisableTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDisableOpen.session), source, reader);
    expectCleanRestore(restoredDisableTrigger);
    expectRestoredLegalActions(restoredDisableTrigger, 0);
    const disableTrigger = getLuaRestoreLegalActions(restoredDisableTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === disableYouAi.uid);
    expect(disableTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDisableTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDisableTrigger, disableTrigger!);
    passRestoredChain(restoredDisableTrigger);

    expect(restoredDisableTrigger.session.state.cards.find((card) => card.uid === disableYouAi.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
    });
    expect(restoredDisableTrigger.session.state.effects.filter((effect) => effect.sourceUid === disableYouAi.uid && [2, 8].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 2, property: 0x400, reset: { flags: 1107169792 }, sourceUid: disableYouAi.uid, value: undefined },
      { code: 8, property: 0x400, reset: { flags: 1107169792 }, sourceUid: disableYouAi.uid, value: 131072 },
    ]);
    expect(restoredDisableTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "customEvent"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventCardUid: disableCyberse.uid, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: disableSummoner.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, eventValue: undefined },
      { eventCardUid: disableYouAi.uid, eventName: "customEvent", eventReason: 0, eventReasonCardUid: disableYouAi.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, eventValue: 0 },
    ]);
    expect(restoredDisableTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const tokenSession = createSession(reader, darkCyberseCode, [youAiCode, darkCyberseCode, summonerCode], []);
    const tokenYouAi = requireCard(tokenSession, youAiCode);
    const tokenSummoner = requireCard(tokenSession, summonerCode);
    const tokenCyberse = requireCard(tokenSession, darkCyberseCode);
    setupField(tokenSession, tokenYouAi, tokenSummoner);
    register(tokenSession, workspace, source);

    const restoredTokenOpen = restoreDuelWithLuaScripts(serializeDuel(tokenSession), source, reader);
    expectCleanRestore(restoredTokenOpen);
    expectRestoredLegalActions(restoredTokenOpen, 0);
    activateAndResolve(restoredTokenOpen, tokenSummoner.uid, 0);
    expect(restoredTokenOpen.session.state.cards.find((card) => card.uid === tokenCyberse.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: tokenSummoner.uid,
      reasonEffectId: 5,
    });

    const restoredTokenTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredTokenOpen.session), source, reader);
    expectCleanRestore(restoredTokenTrigger);
    expectRestoredLegalActions(restoredTokenTrigger, 0);
    const tokenTrigger = getLuaRestoreLegalActions(restoredTokenTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === tokenYouAi.uid);
    expect(tokenTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTokenTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTokenTrigger, tokenTrigger!);
    passRestoredChain(restoredTokenTrigger);

    const tokens = restoredTokenTrigger.session.state.cards.filter((card) => card.code === tokenIgnisterCode && card.location === "monsterZone");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      controller: 0,
      owner: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: tokenYouAi.uid,
      reasonEffectId: 2,
      summonType: "special",
      data: { typeFlags: typesToken, race: raceCyberse, attribute: attributeDark, attack: 0, defense: 0 },
    });
    expect(restoredTokenTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "customEvent"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventCardUid: tokenCyberse.uid, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: tokenSummoner.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, eventValue: undefined },
      { eventCardUid: tokenYouAi.uid, eventName: "customEvent", eventReason: 0, eventReasonCardUid: tokenYouAi.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, eventValue: 0 },
      { eventCardUid: tokens[0]!.uid, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: tokenYouAi.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventValue: undefined },
    ]);
    expect(restoredTokenTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e2:SetCode(EVENT_CUSTOM+id)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.RaiseSingleEvent(e:GetHandler(),EVENT_CUSTOM+id,e,0,tp,tp,0)");
  expect(script).toContain("Duel.GetFlagEffect(tp,id)==0");
  expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_CHAIN,0,1)");
  expect(script).toContain("attr&(ATTRIBUTE_WIND|ATTRIBUTE_LIGHT)~=0");
  expect(script).toContain("e:SetCategory(CATEGORY_DISABLE)");
  const operationInfosEvidence = [
    "Duel.SetOperationInfo(0,CATEGORY_DISABLE,nil,1,PLAYER_ALL,LOCATION_ONFIELD)",
    "Duel.SetOperationInfo(0,CATEGORY_TOKEN,nil,1,0,0)",
    "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,0)",
  ];
  expect(operationInfosEvidence.every((snippet) => script.includes(snippet))).toBe(true);
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,nil,1,PLAYER_ALL,LOCATION_ONFIELD)");
  expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
  expect(script).toContain("e3:SetCode(EFFECT_DISABLE_TRAPMONSTER)");
  expect(script).toContain("attr&(ATTRIBUTE_DARK|ATTRIBUTE_FIRE)~=0");
  expect(script).toContain("e:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)");
  expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,TOKEN_IGNISTER,SET_IGNISTER,TYPES_TOKEN,0,0,1,RACE_CYBERSE,ATTRIBUTE_DARK)");
  expect(script).toContain("local token=Duel.CreateToken(tp,TOKEN_IGNISTER)");
  expect(script).toContain("Duel.SpecialSummon(token,0,tp,tp,false,false,POS_FACEUP)");
}

function createSession(reader: ReturnType<typeof createCardReader>, branchCode: string, playerMain: string[], opponentMain: string[]): DuelSession {
  const session = createDuel({ seed: Number(branchCode), startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: playerMain }, 1: { main: opponentMain } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, branchCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function setupField(session: DuelSession, youAi: DuelCardInstance, summoner: DuelCardInstance): void {
  moveDuelCard(session.state, youAi.uid, "spellTrapZone", 0).faceUp = true;
  moveFaceUpAttack(session, summoner, 0);
}

function register(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, source: { readScript(name: string): string | undefined }): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(youAiCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(summonerCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
}

function branchSummonerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0
          and Duel.IsExistingMatchingCard(Card.IsCanBeSpecialSummoned,tp,LOCATION_HAND,0,1,nil,e,0,tp,false,false) end
        Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)
      end)
      e:SetOperation(function(e,tp)
        Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
        local g=Duel.SelectMatchingCard(tp,Card.IsCanBeSpecialSummoned,tp,LOCATION_HAND,0,1,1,nil,e,0,tp,false,false)
        if #g>0 then Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP) end
      end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function activateAndResolve(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, player: PlayerId): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "activateEffect" && candidate.uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
  passRestoredChain(restored);
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
