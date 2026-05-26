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
const protonCode = "49511705";
const coinMonsterCode = "495117050";
const destroyTargetCode = "495117051";
const discardCode = "495117052";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasProtonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${protonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const categoryCoin = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasProtonScript)("Lua real script Proton Blast chain coin results", () => {
  it("restores coin operation-info watcher into heads-count damage, destroy, and discard effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${protonCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${coinMonsterCode}.lua`) return coinMonsterScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 151, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [protonCode, coinMonsterCode] }, 1: { main: [destroyTargetCode, discardCode] } });
    startDuel(session);

    const proton = requireCard(session, protonCode);
    const coinMonster = requireCard(session, coinMonsterCode);
    const destroyTarget = requireCard(session, destroyTargetCode);
    const discard = requireCard(session, discardCode);
    moveFaceUpSpellTrap(session, proton, 0, 0);
    moveFaceUpAttack(session, coinMonster, 0, 0);
    moveFaceUpAttack(session, destroyTarget, 1, 0);
    moveDuelCard(session.state, discard.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    session.state.players[1].lifePoints = 5000;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(protonCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(coinMonsterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === proton.uid).map((effect) => ({
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { code: 1002, countLimit: undefined, event: "quick", range: ["spellTrapZone"], triggerEvent: undefined },
      { code: 1027, countLimit: 1, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined },
      { code: 1027, countLimit: undefined, event: "quick", range: ["graveyard"], triggerEvent: "chaining" },
    ]);
    const coinActivation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === coinMonster.uid);
    expect(coinActivation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestored(restoredOpen, coinActivation!);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.chain).toEqual([]);

    const heads = restoredOpen.session.state.lastCoinResults.filter((result) => result === 1).length;
    expect(restoredOpen.session.state.lastCoinResults).toEqual([1, 1, 1]);
    expect(heads).toBe(3);
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(4500);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === destroyTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: proton.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: proton.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["coinTossed", "damageDealt", "destroyed", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 3,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: coinMonster.uid,
        eventReasonEffectId: 4,
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: proton.uid,
        eventReasonEffectId: 4,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyTarget.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: proton.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: destroyTarget.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: proton.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: discard.uid,
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: proton.uid,
        eventReasonEffectId: 4,
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
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)");
  expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
  expect(script).toContain("return Duel.GetOperationInfo(ev,CATEGORY_COIN)");
  expect(script).toContain("e1:SetCode(EVENT_TOSS_COIN)");
  expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVED)");
  expect(script).toContain("e2:SetLabelObject(re)");
  expect(script).toContain("local ct=aux.GetCoinHeadsFromEv(ev)");
  expect(script).toContain("Duel.Damage(1-tp,500,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,nil,tp,0,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(tp,hg)");
  expect(script).toContain("Duel.SendtoGrave(sg,REASON_EFFECT|REASON_DISCARD)");
  expect(script).toContain("e3:SetCode(EVENT_CHAINING)");
  expect(script).toContain("Cost.SelfBanish");
  expect(script).toContain("e1:SetCode(EVENT_TOSS_COIN_NEGATE)");
  expect(script).toContain("Duel.SetCoinResult(table.unpack(res))");
}

function coinMonsterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
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
    { code: protonCode, name: "Proton Blast", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: coinMonsterCode, name: "Proton Blast Coin Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: destroyTargetCode, name: "Proton Blast Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: discardCode, name: "Proton Blast Discard", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestored(restored, pass!);
  }
}
