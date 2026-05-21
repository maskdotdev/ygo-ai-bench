import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaSummonTypeLink } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const goldenAllureQueenCode = "95937545";
const allureQueenTargetCode = "29925614";
const allureQueenFieldCode = "959375451";
const offSetDestroyCode = "959375452";
const chainStarterCode = "959375453";
const chainResponderCode = "959375454";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasGoldenAllureQueenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${goldenAllureQueenCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceSpellcaster = 0x2;
const attributeDark = 0x20;
const setAllureQueen = 0x14;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasGoldenAllureQueenScript)("Lua real script Golden Allure Queen summon chain protect", () => {
  it("restores Link-summoned optional trigger availability with Golden Allure Queen field grant", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${goldenAllureQueenCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace);
    const golden = requireCard(session, goldenAllureQueenCode);
    const target = requireCard(session, allureQueenTargetCode);
    moveDuelCard(session.state, target.uid, "deck", 0);
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(goldenAllureQueenCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    specialSummonDuelCard(session.state, golden.uid, 0, 0, { eventReasonCardUid: golden.uid, eventReasonEffectId: 99 }, luaSummonTypeLink, true, true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    expect(session.state.effects.find((effect) => effect.sourceUid === golden.uid && effect.code === 95937545)).toMatchObject({
      event: "continuous",
      property: 2048,
      range: ["monsterZone"],
      targetRange: [1, 0],
    });

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateTrigger" && action.uid === golden.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(activation).toMatchObject({ type: "activateTrigger", uid: golden.uid, windowKind: "triggerBucket", triggerBucket: "turnOptional" });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "deck", controller: 0, faceUp: false });
  });

  it("restores opponent EVENT_CHAINING response that destroys a card and registers Allure Queen protection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${goldenAllureQueenCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace);
    const golden = requireCard(session, goldenAllureQueenCode);
    const allureQueen = requireCard(session, allureQueenFieldCode);
    const destroyTarget = requireCard(session, offSetDestroyCode);
    const starter = requireCard(session, chainStarterCode);
    const responder = requireCard(session, chainResponderCode);
    moveFaceUpAttack(session, golden, 0);
    moveFaceUpAttack(session, allureQueen, 0);
    moveFaceUpAttack(session, destroyTarget, 1);
    moveDuelCard(session.state, starter.uid, "hand", 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(goldenAllureQueenCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(chainStarterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(chainResponderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const response = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === golden.uid);
    expect(response, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    expect(response).toMatchObject({ type: "activateEffect", uid: golden.uid, windowKind: "chainResponse" });
    applyRestoredActionAndAssert(restoredResponse, response!);
    expect(restoredResponse.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-5-1002",
        sourceUid: starter.uid,
        player: 1,
        activationLocation: "hand",
        activationSequence: 0,
      },
      {
        id: "chain-3",
        chainIndex: 2,
        effectId: "lua-4-1027",
        sourceUid: golden.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "chaining",
        eventCode: 1027,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventCardUid: starter.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        operationInfos: [{ category: 0x1, targetUids: [golden.uid, allureQueen.uid, destroyTarget.uid, starter.uid], count: 1, player: 0, parameter: 12 }],
      },
    ]);

    resolveRestoredChain(restoredResponse);
    expect(restoredResponse.host.messages).toContain("golden allure chain starter resolved");
    expect(restoredResponse.host.messages).not.toContain("golden allure chain responder resolved");
    expect(restoredResponse.session.state.cards.find((card) => card.uid === golden.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === allureQueen.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(restoredResponse.session.state.effects.filter((effect) => effect.sourceUid === golden.uid && [41, undefined].includes(effect.code)).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      description: effect.description,
      property: effect.property,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: 41, controller: 0, description: undefined, property: undefined, targetRange: [4, 0] },
      { code: undefined, controller: 0, description: 1535000722, property: 67110912, targetRange: [1, 0] },
    ]);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard", "chainSolved"].includes(event.eventName))).toEqual([
      destroyedEvent(golden.uid),
      sentToGraveyardEvent(golden.uid),
      {
      eventName: "chainSolved",
      eventCode: 1022,
      eventPlayer: 0,
      eventReasonPlayer: 0,
      eventValue: 2,
      relatedEffectId: 4,
      eventChainDepth: 2,
      eventChainLinkId: "chain-3",
    },
    {
      eventName: "sentToGraveyard",
      eventCode: 1014,
      eventCardUid: starter.uid,
      eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      eventReason: duelReason.rule,
      eventReasonPlayer: 1,
    },
    {
      eventName: "chainSolved",
      eventCode: 1022,
      eventPlayer: 1,
      eventReasonPlayer: 1,
      eventValue: 1,
      relatedEffectId: 5,
      eventChainDepth: 1,
      eventChainLinkId: "chain-2",
    },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_SPELLCASTER),3,3)");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsLinkSummoned()");
  expect(script).toContain("e2:SetCode(EFFECT_GOLDEN_ALLURE_QUEEN)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
  expect(script).toContain("e3:SetCategory(CATEGORY_DESTROY)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e3:SetCode(EVENT_CHAINING)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1500)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END,2)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,PLAYER_ALL,LOCATION_ONFIELD)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_ALLURE_QUEEN))");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("aux.RegisterClientHint(c,nil,tp,1,0,aux.Stringid(id,2))");
}

function createSession(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => [goldenAllureQueenCode, allureQueenTargetCode].includes(card.code)),
    { code: allureQueenFieldCode, name: "Golden Allure Queen Field Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1600, defense: 1200, setcodes: [setAllureQueen] },
    { code: offSetDestroyCode, name: "Golden Allure Queen Destroy Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1800, defense: 1000, setcodes: [0x123] },
    { code: chainStarterCode, name: "Golden Allure Queen Chain Starter", kind: "spell", typeFlags: typeSpell },
    { code: chainResponderCode, name: "Golden Allure Queen Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 95937545, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [allureQueenTargetCode, allureQueenFieldCode], extra: [goldenAllureQueenCode] }, 1: { main: [offSetDestroyCode, chainStarterCode, chainResponderCode] } });
  startDuel(session);
  const source = {
    readScript(name: string) {
      if (name === `c${chainStarterCode}.lua`) return chainStarterScript();
      if (name === `c${chainResponderCode}.lua`) return chainResponderScript();
      const loaded = workspace.readScript(name);
      if (loaded === undefined) throw new Error(`Missing script ${name}`);
      return loaded;
    },
  };
  return { session, reader, source };
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
      e:SetOperation(function(e,tp) Debug.Message("golden allure chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("golden allure chain starter resolved") end)
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
  const groups = getLuaRestoreLegalActionGroups(restored, player);
  const actions = getLuaRestoreLegalActions(restored, player);
  expect(actions).toEqual(getLegalActions(restored.session, player));
  expect(groups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(groups.flatMap((group) => group.actions)).toEqual(actions);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function destroyedEvent(uid: string) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: uid,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: uid,
    eventReasonEffectId: 4,
  };
}

function sentToGraveyardEvent(uid: string) {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: uid,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: uid,
    eventReasonEffectId: 4,
  };
}
