import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaSummonTypeFusion } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const serenadeCode = "13935001";
const tokenCode = "13935002";
const fusionCode = "139350010";
const opponentDecoyCode = "139350011";
const handSendCode = "139350012";
const deckLunalightCode = "139350013";
const responderCode = "139350014";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSerenadeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${serenadeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typesToken = 0x4011;
const raceBeastWarrior = 0x8000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setLunalight = 0xdf;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSerenadeScript)("Lua real script Lunalight Serenade Dance Fusion token grave summon stat", () => {
  it("restores the SZONE Fusion Summon trigger into an opponent Token and target ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${serenadeCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_TRIGGER_O+EFFECT_TYPE_FIELD)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_FUSION) and c:IsControler(tp) and c:IsFusionSummoned()");
    expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,id+1,SET_LUNALIGHT,TYPES_TOKEN,2000,2000,1,RACE_BEASTWARRIOR,ATTRIBUTE_DARK,POS_FACEUP,1-tp)");
    expect(script).toContain("Duel.SetTargetCard(g)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOKEN,nil,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,0,0)");
    expect(script).toContain("Duel.CreateToken(tp,id+1)");
    expect(script).toContain("Duel.SpecialSummon(token,0,tp,1-tp,false,false,POS_FACEUP)");
    expect(script).toContain("Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)*500");
    expect(script).toContain("tc:UpdateAttack(atk,RESET_EVENT|RESETS_STANDARD,e:GetHandler())");

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 13935001, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [serenadeCode], extra: [fusionCode] },
      1: { main: [opponentDecoyCode, responderCode] },
    });
    startDuel(session);

    const serenade = requireCard(session, serenadeCode);
    const fusion = requireCard(session, fusionCode);
    const opponentDecoy = requireCard(session, opponentDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, serenade.uid, "spellTrapZone", 0);
    serenade.faceUp = true;
    moveFaceUpAttack(session, opponentDecoy, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = sourceWithResponder(workspace);
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(serenadeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    specialSummonDuelCard(restoredOpen.session.state, fusion.uid, 0, 0, {}, luaSummonTypeFusion);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === fusion.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "fusion",
      summonTypeCode: luaSummonTypeFusion,
    });
    expect(restoredOpen.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === serenade.uid)).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1102",
        sourceUid: serenade.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: fusion.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === serenade.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-2-1102",
        sourceUid: serenade.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: fusion.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [
          { category: 0x400, targetUids: [], count: 1, player: 0, parameter: 0 },
          { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0 },
        ],
        targetFieldIds: [8],
        targetUids: [fusion.uid],
      },
    ]);
    resolveRestoredChain(restoredTrigger);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    const tokens = restoredResolved.session.state.cards.filter((card) => card.code === tokenCode);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      location: "monsterZone",
      controller: 1,
      owner: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: serenade.uid,
      reasonEffectId: 2,
    });
    expect(tokens[0]!.data).toMatchObject({
      code: tokenCode,
      name: "Lunalight Token",
      typeFlags: typesToken,
      race: raceBeastWarrior,
      attribute: attributeDark,
      level: 1,
      attack: 2000,
      defense: 2000,
      setcodes: [setLunalight],
    });
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === fusion.uid), restoredResolved.session.state)).toBe(2800);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === fusion.uid)).toMatchObject({ attackModifier: 1000 });
    expect(restoredResolved.session.state.effects.filter((effect) => effect.code === 100)).toEqual([]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      specialSummonedEvent(fusion.uid, undefined, undefined, undefined, { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 }, { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 }),
      specialSummonedEvent(tokens[0]!.uid, [tokens[0]!.uid], serenade.uid, 2, { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 }, { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 }),
    ]);
    expect(restoredResolved.host.messages).not.toContain("lunalight serenade responder resolved");
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores the graveyard Quick Effect into SelfBanish cost, hand send, and Deck Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${serenadeCode}.lua`);
    expect(script).toContain("e3:SetCategory(CATEGORY_TOGRAVE+CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e3:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e3:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e3:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("e3:SetCountLimit(1,id)");
    expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
    expect(script).toContain("return Duel.IsTurnPlayer(tp) and Duel.IsMainPhase()");
    expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsAbleToGrave,tp,LOCATION_HAND,0,1,nil)");
    expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE,tp)>0");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_DECK,0,1,nil,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_HAND)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToGrave,tp,LOCATION_HAND,0,1,1,nil):GetFirst()");
    expect(script).toContain("Duel.SendtoGrave(tgc,REASON_EFFECT)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)");

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 13935002, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [serenadeCode, handSendCode, deckLunalightCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const serenade = requireCard(session, serenadeCode);
    const handSend = requireCard(session, handSendCode);
    const deckLunalight = requireCard(session, deckLunalightCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, serenade.uid, "graveyard", 0);
    serenade.faceUp = true;
    serenade.position = "faceUpAttack";
    moveDuelCard(session.state, handSend.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = sourceWithResponder(workspace);
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(serenadeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === serenade.uid && action.effectId === "lua-3-1002");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === serenade.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonCardUid: serenade.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-3-1002",
        sourceUid: serenade.uid,
        player: 0,
        activationLocation: "graveyard",
        activationSequence: 0,
        operationInfos: [
          { category: 0x20, targetUids: [], count: 1, player: 0, parameter: 0x2 },
          { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === handSend.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: serenade.uid,
      reasonEffectId: 3,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === deckLunalight.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: serenade.uid,
      reasonEffectId: 3,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["banished", "sentToGraveyard", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: serenade.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: serenade.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: handSend.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: serenade.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      specialSummonedEvent(deckLunalight.uid, [deckLunalight.uid], serenade.uid, 3, { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 }, { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 }),
    ]);
    expect(restoredChain.host.messages).not.toContain("lunalight serenade responder resolved");
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === serenadeCode),
    { code: tokenCode, name: "Lunalight Token", kind: "monster", typeFlags: typesToken, race: raceBeastWarrior, attribute: attributeDark, level: 1, attack: 2000, defense: 2000, setcodes: [setLunalight] },
    { code: fusionCode, name: "Lunalight Serenade Fixture Fusion", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceBeastWarrior, attribute: attributeDark, level: 7, attack: 1800, defense: 1200, setcodes: [setLunalight] },
    { code: opponentDecoyCode, name: "Lunalight Serenade Opponent Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: handSendCode, name: "Lunalight Serenade Hand Send", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: deckLunalightCode, name: "Lunalight Serenade Deck Lunalight", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1000, setcodes: [setLunalight] },
    { code: responderCode, name: "Lunalight Serenade Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function sourceWithResponder(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      return workspace.readScript(name);
    },
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
      e:SetOperation(function(e,tp) Debug.Message("lunalight serenade responder resolved") end)
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

function specialSummonedEvent(cardUid: string, eventUids: string[] | undefined, sourceUid: string | undefined, sourceEffectId: number | undefined, eventPreviousState: object, eventCurrentState: object) {
  return {
    eventName: "specialSummoned",
    eventCode: 1102,
    eventCardUid: cardUid,
    ...(eventUids === undefined ? {} : { eventUids }),
    eventReason: duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    ...(sourceUid === undefined ? {} : { eventReasonCardUid: sourceUid }),
    ...(sourceEffectId === undefined ? {} : { eventReasonEffectId: sourceEffectId }),
    eventPreviousState,
    eventCurrentState,
  };
}
