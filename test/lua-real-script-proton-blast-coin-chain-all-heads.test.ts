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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const protonBlastCode = "49511705";
const coinMonsterCode = "495117050";
const targetCode = "495117051";
const handCode = "495117052";
const hasProtonBlastScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${protonBlastCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const categoryCoin = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasProtonBlastScript)("Lua real script Proton Blast coin chain all heads", () => {
  it("restores grave quick coin-result replacement into all three Proton Blast rewards", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${protonBlastCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 49511705, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [protonBlastCode, protonBlastCode, coinMonsterCode] }, 1: { main: [targetCode, handCode] } });
    startDuel(session);

    const protonBlasts = requireCards(session, protonBlastCode, 2);
    const fieldProtonBlast = protonBlasts[0]!;
    const graveProtonBlast = protonBlasts[1]!;
    const coinMonster = requireCard(session, coinMonsterCode);
    const target = requireCard(session, targetCode);
    const hand = requireCard(session, handCode);
    moveFaceUpSpellTrap(session, fieldProtonBlast, 0, 0);
    moveToGrave(session, graveProtonBlast, 0, 0);
    moveFaceUpAttack(session, coinMonster, 0, 0);
    moveFaceUpAttack(session, target, 1, 0);
    moveToHand(session, hand, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${coinMonsterCode}.lua`) return coinMonsterScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(protonBlastCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(coinMonsterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === coinMonster.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    const activationAction = activation as Extract<DuelAction, { type: "activateEffect" }>;
    applyRestored(restoredOpen, activationAction);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: activationAction.effectId,
        sourceUid: coinMonster.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        operationInfos: [{ category: categoryCoin, targetUids: [], count: 0, player: 0, parameter: 3 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 0);
    const protonResponse = getLuaRestoreLegalActions(restoredChain, 0).find((action) => action.type === "activateEffect" && action.uid === graveProtonBlast.uid);
    expect(protonResponse, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 0), null, 2)).toBeDefined();
    applyRestored(restoredChain, protonResponse!);
    expect(restoredChain.session.state.cards.find((card) => card.uid === graveProtonBlast.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
    });

    const restoredResolution = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredResolution);
    passRestoredChain(restoredResolution, 1);
    expect(restoredResolution.session.state.chain).toEqual([]);
    expect(restoredResolution.session.state.lastCoinResults).toEqual([1, 1, 1]);
    expect(restoredResolution.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredResolution.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.destroy | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: fieldProtonBlast.uid,
    });
    expect(restoredResolution.session.state.cards.find((card) => card.uid === hand.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.discard | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: fieldProtonBlast.uid,
    });
    expect(restoredResolution.session.state.eventHistory.filter((event) => ["coinTossed", "destroyed", "confirmed", "discarded"].includes(event.eventName))).toMatchObject([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 3,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: coinMonster.uid,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target.uid,
        eventReason: duelReason.destroy | duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: fieldProtonBlast.uid,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: hand.uid,
        eventPlayer: 0,
      },
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: hand.uid,
        eventReason: duelReason.discard | duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: fieldProtonBlast.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Proton Blast");
  expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
  expect(script).toContain("return Duel.GetOperationInfo(ev,CATEGORY_COIN)");
  expect(script).toContain("e1:SetCode(EVENT_TOSS_COIN)");
  expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVED)");
  expect(script).toContain("e2:SetLabelObject(re)");
  expect(script).toContain("local ct=aux.GetCoinHeadsFromEv(ev)");
  expect(script).toContain("Duel.Damage(1-tp,500,REASON_EFFECT)");
  expect(script).toContain("Duel.HintSelection(g)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(tp,hg)");
  expect(script).toContain("Duel.SendtoGrave(sg,REASON_EFFECT|REASON_DISCARD)");
  expect(script).toContain("Duel.ShuffleHand(1-tp)");
  expect(script).toContain("e3:SetCode(EVENT_CHAINING)");
  expect(script).toContain("e3:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
  expect(script).toContain("if ex and ct>1 then");
  expect(script).toContain("e1:SetCode(EVENT_TOSS_COIN_NEGATE)");
  expect(script).toContain("Duel.SetCoinResult(table.unpack(res))");
}

function coinMonsterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetDescription(aux.Stringid(id,0))
      e:SetCategory(CATEGORY_COIN)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,3)
      end)
      e:SetOperation(function(e,tp)
        Duel.TossCoin(tp,3)
      end)
      c:RegisterEffect(e)
    end
  `;
}

function cards(): DuelCardData[] {
  return [
    { code: protonBlastCode, name: "Proton Blast", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: coinMonsterCode, name: "Proton Blast Coin Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: targetCode, name: "Proton Blast Destroy Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: handCode, name: "Proton Blast Hand Card", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireCards(session: DuelSession, code: string, count: number): DuelCardInstance[] {
  const cards = session.state.cards.filter((candidate) => candidate.code === code);
  expect(cards).toHaveLength(count);
  return cards;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveToGrave(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "graveyard", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  return moved;
}

function moveToHand(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "hand", player);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDown";
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    expectRestoredLegalActions(restored, player);
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestored(restored, pass!);
  }
}
