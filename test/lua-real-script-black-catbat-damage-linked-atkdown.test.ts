import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
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
const blackCatbatCode = "94626871";
const linkedCode = "946268710";
const damageSourceCode = "946268711";
const opponentACode = "946268712";
const opponentBCode = "946268713";
const responderCode = "946268714";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const setTrickstar = 0xfb;
const raceFairy = 0x4;

describe.skipIf(!hasUpstreamScripts)("Lua real script Black Catbat damage linked ATK down", () => {
  it("restores Trickstar monster-effect damage into linked-count opponent ATK reductions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${blackCatbatCode}.lua`);
    expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_TRICKSTAR),2,2)");
    expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("e3:SetCode(EVENT_DAMAGE)");
    expect(script).toContain("return ep~=tp and r&REASON_BATTLE==0 and re");
    expect(script).toContain("and re:IsMonsterEffect() and re:GetHandler():IsSetCard(SET_TRICKSTAR)");
    expect(script).toContain("local ct=c:GetLinkedGroupCount()");
    expect(script).toContain("local g=Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("for tc in aux.Next(g) do");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-ct*200)");

    const cards: DuelCardData[] = [
      { code: blackCatbatCode, name: "Trickstar Black Catbat", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, setcodes: [setTrickstar], race: raceFairy, level: 2, attack: 2000, defense: 0, linkMarkers: 0x20 },
      { code: linkedCode, name: "Black Catbat Linked Monster", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setTrickstar], race: raceFairy, level: 4, attack: 1000, defense: 1000 },
      { code: damageSourceCode, name: "Black Catbat Trickstar Burn Source", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setTrickstar], race: raceFairy, level: 4, attack: 1200, defense: 1000 },
      { code: opponentACode, name: "Black Catbat Opponent A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, level: 4, attack: 1800, defense: 1000 },
      { code: opponentBCode, name: "Black Catbat Opponent B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, level: 4, attack: 1600, defense: 1000 },
      { code: responderCode, name: "Black Catbat Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 94626871, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [linkedCode, damageSourceCode], extra: [blackCatbatCode] },
      1: { main: [opponentACode, opponentBCode, responderCode] },
    });
    startDuel(session);

    const blackCatbat = requireCard(session, blackCatbatCode);
    const linked = requireCard(session, linkedCode);
    const damageSource = requireCard(session, damageSourceCode);
    const opponentA = requireCard(session, opponentACode);
    const opponentB = requireCard(session, opponentBCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, blackCatbat, 0, 2);
    moveFaceUpAttack(session, linked, 0, 3);
    moveFaceUpAttack(session, damageSource, 0, 0);
    moveFaceUpAttack(session, opponentA, 1, 0);
    moveFaceUpAttack(session, opponentB, 1, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${damageSourceCode}.lua`) return damageSourceScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(blackCatbatCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(damageSourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === damageSource.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    const restoredDamageChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredDamageChain);
    expectRestoredLegalActions(restoredDamageChain, 1);
    const passDamage = getLuaRestoreLegalActions(restoredDamageChain, 1).find((action) => action.type === "passChain");
    expect(passDamage, JSON.stringify(getLuaRestoreLegalActions(restoredDamageChain, 1), null, 2)).toBeDefined();
    applyRestoredAction(restoredDamageChain, passDamage!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDamageChain.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-4-1111",
        sourceUid: blackCatbat.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 300,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: damageSource.uid,
        eventReasonEffectId: 1,
        eventTriggerTiming: "when",
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === blackCatbat.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(("operationInfos" in trigger! ? trigger!.operationInfos : []) ?? []).toEqual([]);
    applyRestoredAction(restoredTrigger, trigger!);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 1);
    expect(restoredResolved.session.state.chain).toEqual([
      {
        id: "chain-5",
        chainIndex: 1,
        effectId: "lua-4-1111",
        sourceUid: blackCatbat.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 2,
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 300,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: damageSource.uid,
        eventReasonEffectId: 1,
        eventTriggerTiming: "when",
      },
    ]);
    const passTrigger = getLuaRestoreLegalActions(restoredResolved, 1).find((action) => action.type === "passChain");
    expect(passTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredResolved, 1), null, 2)).toBeDefined();
    applyRestoredAction(restoredResolved, passTrigger!);
    expect(restoredResolved.session.state.players[1].lifePoints).toBe(7700);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === opponentA.uid), restoredResolved.session.state)).toBe(1600);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === opponentB.uid), restoredResolved.session.state)).toBe(1400);
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 300,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: damageSource.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  moveDuelCard(session.state, card.uid, "monsterZone", controller);
  card.sequence = sequence;
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.reason = duelReason.summon;
  card.reasonPlayer = controller;
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
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function damageSourceScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DAMAGE)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp) Duel.Damage(1-tp,300,REASON_EFFECT) end)
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
      e:SetOperation(function() Debug.Message("black catbat responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
