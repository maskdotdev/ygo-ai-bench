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
const blackFangCode = "75672051";
const opponentTargetCode = "756720510";
const graveSpellcasterCode = "756720511";
const responderCode = "756720512";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBlackFangScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${blackFangCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasBlackFangScript)("Lua real script Black Fang Magician PZONE destroy revive", () => {
  it("restores PZONE target halve into self-destroyed delayed DARK Spellcaster revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${blackFangCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace);
    const blackFang = requireCard(session, blackFangCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const graveSpellcaster = requireCard(session, graveSpellcasterCode);
    const responder = requireCard(session, responderCode);
    movePzone(session, blackFang, 0, 0);
    moveFaceUpAttack(session, opponentTarget, 1);
    moveDuelCard(session.state, graveSpellcaster.uid, "graveyard", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(blackFangCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const halve = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === blackFang.uid);
    expect(halve, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, halve!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-3",
        sourceUid: blackFang.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetFieldIds: [opponentTarget.fieldId],
        targetUids: [opponentTarget.uid],
        operationInfos: [{ category: 0x1, targetUids: [blackFang.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("black fang responder resolved");
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredChain.session.state)).toBe(1000);
    expect(restoredChain.session.state.cards.find((card) => card.uid === blackFang.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: blackFang.uid,
      reasonEffectId: 3,
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-5-1",
        effectId: "lua-4-1029",
        sourceUid: blackFang.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "destroyed",
        eventCode: 1029,
        eventPlayer: 0,
        eventCardUid: blackFang.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: blackFang.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventTriggerTiming: "if",
      },
    ]);
    const revive = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === blackFang.uid);
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, revive!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-6",
        chainIndex: 1,
        effectId: "lua-4-1029",
        sourceUid: blackFang.uid,
        player: 0,
        activationLocation: "extraDeck",
        activationSequence: 0,
        eventName: "destroyed",
        eventCode: 1029,
        eventPlayer: 0,
        eventCardUid: blackFang.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: blackFang.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventTriggerTiming: "if",
        targetFieldIds: [graveSpellcaster.fieldId],
        targetUids: [graveSpellcaster.uid],
        operationInfos: [{ category: 0x200, targetUids: [graveSpellcaster.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredReviveChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredReviveChain);
    resolveRestoredChain(restoredReviveChain);
    expect(restoredReviveChain.session.state.cards.find((card) => card.uid === graveSpellcaster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: blackFang.uid,
      reasonEffectId: 4,
    });
    expect(restoredReviveChain.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: opponentTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: blackFang.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: blackFang.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: graveSpellcaster.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 4,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: graveSpellcaster.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: blackFang.uid,
        eventReasonEffectId: 4,
        eventUids: [graveSpellcaster.uid],
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DESTROY)");
  expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,e:GetHandler(),1,0,0)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(math.floor(tc:GetAttack()/2))");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("return r&(REASON_EFFECT|REASON_BATTLE)~=0");
  expect(script).toContain("return c:IsAttribute(ATTRIBUTE_DARK) and c:IsRace(RACE_SPELLCASTER) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
}

function createSession(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === blackFangCode),
    { code: opponentTargetCode, name: "Black Fang Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2000, defense: 1000 },
    { code: graveSpellcasterCode, name: "Black Fang Grave Spellcaster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
    { code: responderCode, name: "Black Fang Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 75672051, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [blackFangCode, graveSpellcasterCode] }, 1: { main: [opponentTargetCode, responderCode] } });
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
      e:SetOperation(function(e,tp) Debug.Message("black fang responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function movePzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
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
