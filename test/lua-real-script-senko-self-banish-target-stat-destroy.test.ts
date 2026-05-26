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
const senkoCode = "62503746";
const ownWarriorCode = "625037460";
const opponentTargetCode = "625037461";
const responderCode = "625037462";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSenkoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${senkoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceFiend = 0x8;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasSenkoScript)("Lua real script Senko self-banish target stat destroy", () => {
  it("restores SelfBanish SelectUnselectGroup targets into own Warrior ATK loss and opponent destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${senkoCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e3:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e3:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e3:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
    expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,2,2,s.rescon,0)");
    expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,2,2,s.rescon,1,tp,HINTMSG_TARGET)");
    expect(script).toContain("Duel.SetTargetCard(tg)");
    expect(script).toContain("e:SetLabelObject(hg:GetFirst())");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,hg,1,tp,-1500)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,tg-hg,1,tp,0)");
    expect(script).toContain("local g=Duel.GetTargetCards(e)");
    expect(script).toContain("tc1:UpdateAttack(-1500,RESET_EVENT|RESETS_STANDARD,e:GetHandler())==-1500");
    expect(script).toContain("Duel.Destroy(tc2,REASON_EFFECT)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 62503746, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [senkoCode, ownWarriorCode] }, 1: { main: [opponentTargetCode, responderCode] } });
    startDuel(session);

    const senko = requireCard(session, senkoCode);
    const ownWarrior = requireCard(session, ownWarriorCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, senko.uid, "graveyard", 0);
    senko.faceUp = true;
    moveFaceUpAttack(session, ownWarrior, 0);
    moveFaceUpAttack(session, opponentTarget, 1);
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
    expect(host.loadCardScript(Number(senkoCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === senko.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === senko.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: senko.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-3",
        effectLabelObjectUid: ownWarrior.uid,
        sourceUid: senko.uid,
        player: 0,
        activationLocation: "graveyard",
        activationSequence: 0,
        targetFieldIds: [6, 7],
        targetUids: [ownWarrior.uid, opponentTarget.uid],
        operationInfos: [
          { category: 0x200000, targetUids: [ownWarrior.uid], count: 1, player: 0, parameter: -1500 },
          { category: 0x1, targetUids: [opponentTarget.uid], count: 1, player: 0, parameter: 0 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("senko responder resolved");
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === ownWarrior.uid), restoredChain.session.state)).toBe(900);
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: senko.uid,
      reasonEffectId: 3,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["banished", "becameTarget", "destroyed", "sentToGraveyard", "chainSolved"].includes(event.eventName))).toEqual([
      banishedEvent(senko.uid),
      becameTargetEvent(ownWarrior.uid, { controller: 0, sequence: 0 }),
      becameTargetEvent(opponentTarget.uid, { controller: 1, sequence: 1 }),
      destroyedEvent(opponentTarget.uid, senko.uid),
      sentToGraveyardEvent(opponentTarget.uid, senko.uid),
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

function cards(): DuelCardData[] {
  return [
    { code: senkoCode, name: "Senko the Skybolt Star", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 7, attack: 2400, defense: 1000 },
    { code: ownWarriorCode, name: "Senko High-Level Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 6, attack: 2400, defense: 1000 },
    { code: opponentTargetCode, name: "Senko Opponent Attack Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: responderCode, name: "Senko Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
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
      e:SetOperation(function(e,tp) Debug.Message("senko responder resolved") end)
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

function banishedEvent(cardUid: string) {
  return {
    eventName: "banished",
    eventCode: 1011,
    eventCardUid: cardUid,
    eventReason: duelReason.cost,
    eventReasonPlayer: 0,
    eventReasonCardUid: cardUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
  };
}

function becameTargetEvent(cardUid: string, expected: { controller: PlayerId; sequence: number }) {
  return {
    eventName: "becameTarget",
    eventCode: 1028,
        eventValue: 1,
    eventCardUid: cardUid,
    eventReason: 0,
    eventReasonPlayer: 0,
    relatedEffectId: 3,
    eventChainDepth: 1,
    eventChainLinkId: "chain-3",
    eventPreviousState: { controller: expected.controller, faceUp: false, location: "deck", position: "faceDown", sequence: expected.sequence },
    eventCurrentState: { controller: expected.controller, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
  };
}

function destroyedEvent(cardUid: string, reasonCardUid: string) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: reasonCardUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
}

function sentToGraveyardEvent(cardUid: string, reasonCardUid: string) {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: reasonCardUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
}
