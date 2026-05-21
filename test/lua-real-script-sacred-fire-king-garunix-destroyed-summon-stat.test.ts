import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const garunixCode = "66431519";
const destroyedFireCode = "664315190";
const destroyDeckFireCode = "664315191";
const responderCode = "664315192";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGarunixScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${garunixCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceBeast = 0x4000;
const raceBeastWarrior = 0x8000;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasGarunixScript)("Lua real script Sacred Fire King Garunix destroyed summon stat", () => {
  it("restores simultaneous-check destroyed FIRE trigger into hand self Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${garunixCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace);
    const garunix = requireCard(session, garunixCode);
    const destroyedFire = requireCard(session, destroyedFireCode);
    moveDuelCard(session.state, garunix.uid, "hand", 0);
    moveFaceUpAttack(session, destroyedFire, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(garunixCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    destroyDuelCard(session.state, destroyedFire.uid, 0, duelReason.effect | duelReason.destroy, 0, "graveyard", { eventReasonCardUid: destroyedFire.uid, eventReasonEffectId: 99 });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === garunix.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === garunix.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: garunix.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard", "specialSummoned"].includes(event.eventName))).toEqual([
      destroyedEvent(destroyedFire.uid, destroyedFire.uid, 99, 0),
      sentToGraveyardEvent(destroyedFire.uid, destroyedFire.uid, 99, 0),
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: garunix.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: garunix.uid,
        eventReasonEffectId: 1,
        eventUids: [garunix.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });

  it("restores summon-success FIRE destroy selection into ATK gain from destroyed monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${garunixCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace);
    const garunix = requireCard(session, garunixCode);
    const destroyedFire = requireCard(session, destroyedFireCode);
    const deckFire = requireCard(session, destroyDeckFireCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, garunix.uid, "hand", 0);
    moveDuelCard(session.state, destroyedFire.uid, "graveyard", 0);
    moveDuelCard(session.state, deckFire.uid, "deck", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(garunixCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    specialSummonDuelCard(session.state, garunix.uid, 0, 0, { eventReasonCardUid: garunix.uid, eventReasonEffectId: 88 }, 0, true, true);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === garunix.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-3-1102",
        sourceUid: garunix.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventPlayer: 0,
        eventCardUid: garunix.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: garunix.uid,
        eventReasonEffectId: 88,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [
          { category: 0x1, targetUids: [], count: 1, player: 0, parameter: 0x07 },
          { category: 0x200000, targetUids: [garunix.uid], count: 1, player: 0, parameter: 0 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("sacred garunix responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === deckFire.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: garunix.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === garunix.uid), restoredChain.session.state)).toBe(3700);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard", "chainSolved"].includes(event.eventName))).toEqual([
      destroyedEvent(deckFire.uid, garunix.uid, 3, 0, { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 }, { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 }),
      sentToGraveyardEvent(deckFire.uid, garunix.uid, 3, 0, { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 }, { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 }),
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY,EFFECT_FLAG2_CHECK_SIMULTANEOUS)");
  expect(script).toContain("e1:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND|LOCATION_GRAVE)");
  expect(script).toContain("return eg:IsExists(s.spconfilter,1,nil,tp)");
  expect(script).toContain("and not (c:IsLocation(LOCATION_GRAVE) and eg:IsContains(c))");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,nil,1,tp,LOCATION_HAND|LOCATION_DECK|LOCATION_MZONE)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,tp,0)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.desfilter,tp,LOCATION_HAND|LOCATION_DECK|LOCATION_MZONE,0,1,1,nil):GetFirst()");
  expect(script).toContain("local atk=tc:GetAttack()//2");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)>0");
  expect(script).toContain("c:UpdateAttack(atk,RESETS_STANDARD_DISABLE_PHASE_END)");
}

function createSession(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === garunixCode),
    { code: destroyedFireCode, name: "Sacred Garunix Destroyed FIRE", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeFire, level: 4, attack: 1200, defense: 1000 },
    { code: destroyDeckFireCode, name: "Sacred Garunix Deck FIRE", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 2000, defense: 1000 },
    { code: responderCode, name: "Sacred Garunix Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 66431519, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [garunixCode, destroyedFireCode, destroyDeckFireCode] }, 1: { main: [responderCode] } });
  startDuel(session);
  const source = {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return chainResponderScript();
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
      e:SetOperation(function(e,tp) Debug.Message("sacred garunix responder resolved") end)
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

function destroyedEvent(uid: string, reasonCardUid: string, reasonEffectId: number, controller: PlayerId, previous = { controller, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 }, current = { controller, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 }) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: uid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: reasonCardUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: previous,
    eventCurrentState: current,
  };
}

function sentToGraveyardEvent(uid: string, reasonCardUid: string, reasonEffectId: number, controller: PlayerId, previous = { controller, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 }, current = { controller, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 }) {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: uid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: reasonCardUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: previous,
    eventCurrentState: current,
  };
}
