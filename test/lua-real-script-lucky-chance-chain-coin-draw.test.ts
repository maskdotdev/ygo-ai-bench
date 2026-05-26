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
const luckyChanceCode = "96012004";
const coinMonsterCode = "960120040";
const drawCode = "960120041";
const hasLuckyChanceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${luckyChanceCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const categoryCoin = 0x1000000;
const categoryDraw = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasLuckyChanceScript)("Lua real script Lucky Chance chain coin draw", () => {
  it("restores GetOperationInfo coin-chain matching into AnnounceCoin delayed draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${luckyChanceCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [luckyChanceCode, coinMonsterCode, drawCode] }, 1: { main: [] } });
    startDuel(session);

    const lucky = requireCard(session, luckyChanceCode);
    const coinMonster = requireCard(session, coinMonsterCode);
    moveFaceUpSpellTrap(session, lucky, 0, 0);
    moveFaceUpAttack(session, coinMonster, 0, 0);
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
    expect(host.loadCardScript(Number(luckyChanceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(coinMonsterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === coinMonster.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestored(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-3",
        sourceUid: coinMonster.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        operationInfos: [{ category: categoryCoin, targetUids: [], count: 0, player: 0, parameter: 1 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 0);
    const luckyResponse = getLuaRestoreLegalActions(restoredChain, 0).find((action) => action.type === "activateEffect" && action.uid === lucky.uid && action.effectId === "lua-2-1027");
    expect(luckyResponse, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 0), null, 2)).toBeDefined();
    applyRestored(restoredChain, luckyResponse!);

    const restoredResolution = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredResolution);
    expectRestoredLegalActions(restoredResolution, 0);
    expect(restoredResolution.session.state.chain).toEqual([]);

    expect(restoredResolution.session.state.lastCoinResults).toEqual([1]);
    expect(restoredResolution.session.state.cards.filter((card) => card.location === "hand" && card.controller === 0)).toHaveLength(1);
    expect(restoredResolution.session.state.cards.find((card) => card.code === drawCode)).toMatchObject({
      location: "hand",
      controller: 0,
      reasonPlayer: 0,
    });
    expect(restoredResolution.session.state.eventHistory.filter((event) => ["coinTossed", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: coinMonster.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: restoredResolution.session.state.cards.find((card) => card.code === drawCode)?.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: lucky.uid,
        eventReasonEffectId: 4,
        eventUids: [restoredResolution.session.state.cards.find((card) => card.code === drawCode)?.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Lucky Chance");
  expect(script).toContain("e2:SetCategory(CATEGORY_DRAW)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_F)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
  expect(script).toContain("local ex,eg,et,cp,ct=Duel.GetOperationInfo(ev,CATEGORY_COIN)");
  expect(script).toContain("if ex and ct==1 and re:IsMonsterEffect() then");
  expect(script).toContain("e:SetLabelObject(re)");
  expect(script).toContain("local res=Duel.AnnounceCoin(tp)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e1:SetCode(EVENT_TOSS_COIN)");
  expect(script).toContain("e1:SetReset(RESET_CHAIN)");
  expect(script).toContain("e1:SetLabelObject(e:GetLabelObject())");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("local res,extra=Duel.GetCoinResult()");
  expect(script).toContain("return not extra and re==e:GetLabelObject() and res==e:GetLabel()");
  expect(script).toContain("Duel.Draw(tp,1,REASON_EFFECT)");
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
        Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Duel.TossCoin(tp,1)
      end)
      c:RegisterEffect(e)
    end
  `;
}

function cards(): DuelCardData[] {
  return [
    { code: luckyChanceCode, name: "Lucky Chance", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: coinMonsterCode, name: "Lucky Chance Coin Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: drawCode, name: "Lucky Chance Draw Card", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestored(restored, pass!);
  }
}
