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
const gardenCode = "71645242";
const plantOneCode = "716452420";
const plantTwoCode = "716452421";
const reviveCode = "716452422";
const responderCode = "716452423";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGardenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gardenCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeField = 0x80000;
const racePlant = 0x400;
const raceWarrior = 0x1;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasGardenScript)("Lua real script Black Garden destroy Plants revive", () => {
  it("restores Field ignition destroying all Plants and itself into previous-ATK matched Graveyard revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gardenCode}.lua`);
    expect(script).toContain("aux.GlobalCheck(s,function()");
    expect(script).toContain("Duel.RaiseEvent(eg,EVENT_CUSTOM+id,e,r,rp,ep,e:GetLabel())");
    expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY+CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e2:SetRange(LOCATION_FZONE)");
    expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsRace,RACE_PLANT),tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("local atk=g:GetSum(Card.GetAttack)");
    expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,atk,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,tg,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)");
    expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");
    expect(script).toContain("local og=Duel.GetOperatedGroup()");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("local atk=og:GetSum(Card.GetPreviousAttackOnField)");
    expect(script).toContain("Duel.SpecialSummon(tc,SUMMONED_BY_BLACK_GARDEN,tp,tp,false,false,POS_FACEUP)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 71645242, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gardenCode, plantOneCode, reviveCode] }, 1: { main: [plantTwoCode, responderCode] } });
    startDuel(session);

    const garden = requireCard(session, gardenCode);
    const plantOne = requireCard(session, plantOneCode);
    const plantTwo = requireCard(session, plantTwoCode, 1);
    const revive = requireCard(session, reviveCode);
    const responder = requireCard(session, responderCode, 1);
    moveDuelCard(session.state, garden.uid, "spellTrapZone", 0).faceUp = true;
    moveFaceUpAttack(session, plantOne, 0);
    moveFaceUpAttack(session, plantTwo, 1);
    moveDuelCard(session.state, revive.uid, "graveyard", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gardenCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === garden.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-3",
        effectLabel: 2500,
        sourceUid: garden.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetFieldIds: [revive.fieldId],
        targetUids: [revive.uid],
        operationInfos: [
          { category: 0x200, targetUids: [revive.uid], count: 1, player: 0, parameter: 0 },
          { category: 0x1, targetUids: [plantOne.uid, plantTwo.uid, garden.uid], count: 3, player: 0, parameter: 0 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("black garden responder resolved");
    expect(restoredChain.session.state.chain).toEqual([]);
    expect(restoredChain.session.state.cards.find((card) => card.uid === revive.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      summonTypeCode: 0x40000020,
    });
    for (const destroyed of [plantOne, plantTwo, garden]) {
      expect(restoredChain.session.state.cards.find((card) => card.uid === destroyed.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.effect | duelReason.destroy,
        reasonPlayer: 0,
        reasonCardUid: garden.uid,
        reasonEffectId: 3,
      });
    }
    expect(restoredChain.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "breakEffect", "specialSummoned"].includes(event.eventName))).toEqual([
      becameTargetEvent(revive.uid, garden.uid),
      destroyedEvent(plantOne.uid, garden.uid, 0, "monsterZone", 1),
      destroyedEvent(plantTwo.uid, garden.uid, 1),
      destroyedEvent(garden.uid, garden.uid, 0, "spellTrapZone", 2),
      destroyedGroupEvent([plantOne.uid, plantTwo.uid, garden.uid], plantOne.uid, garden.uid),
      breakEffectEvent(garden.uid),
      specialSummonedEvent(revive.uid, garden.uid),
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: gardenCode, name: "Black Garden", kind: "spell", typeFlags: typeSpell | typeField },
    { code: plantOneCode, name: "Black Garden Plant One", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: plantTwoCode, name: "Black Garden Plant Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
    { code: reviveCode, name: "Black Garden Revive Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2500, defense: 1000 },
    { code: responderCode, name: "Black Garden Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
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
      e:SetOperation(function(e,tp) Debug.Message("black garden responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function becameTargetEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "becameTarget",
    eventCode: 1028,
        eventValue: 1,
    eventCardUid: cardUid,
    eventReason: 0,
    eventReasonPlayer: 0,
    relatedEffectId: 3,
    eventChainDepth: 1,
    eventChainLinkId: "chain-2",
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
  };
}

function destroyedEvent(cardUid: string, sourceUid: string, controller: PlayerId, previousLocation: "monsterZone" | "spellTrapZone" = "monsterZone", currentSequence = 0) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller, faceUp: true, location: previousLocation, position: previousLocation === "monsterZone" ? "faceUpAttack" : "faceDown", sequence: 0 },
    eventCurrentState: { controller, faceUp: true, location: "graveyard", position: previousLocation === "monsterZone" ? "faceUpAttack" : "faceDown", sequence: currentSequence },
  };
}

function destroyedGroupEvent(eventUids: string[], cardUid: string, sourceUid: string) {
  return {
    ...destroyedEvent(cardUid, sourceUid, 0, "monsterZone", 1),
    eventUids,
  };
}

function breakEffectEvent(sourceUid: string) {
  return {
    eventName: "breakEffect",
    eventCode: 1050,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
  };
}

function specialSummonedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "specialSummoned",
    eventCode: 1102,
    eventCardUid: cardUid,
    eventUids: [cardUid],
    eventReason: duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
  };
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
