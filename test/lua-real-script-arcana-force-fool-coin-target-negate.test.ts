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
const foolCode = "62892347";
const targetingSpellCode = "628923470";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFoolScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${foolCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const categoryCoin = 0x1000000;
const categoryDestroy = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasFoolScript)("Lua real script Arcana Force 0 The Fool coin target negate", () => {
  it("restores heads Arcana registration into chain-solving targeted effect negation and handler destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${foolCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${targetingSpellCode}.lua`) return targetingSpellScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [foolCode, targetingSpellCode] }, 1: { main: [] } });
    startDuel(session);

    const fool = requireCard(session, foolCode);
    const targetingSpell = requireCard(session, targetingSpellCode);
    moveDuelCard(session.state, fool.uid, "hand", 0);
    moveDuelCard(session.state, targetingSpell.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(foolCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(targetingSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === fool.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestored(restoredOpen, summon!);

    const restoredCoinTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredCoinTrigger);
    expectRestoredLegalActions(restoredCoinTrigger, 0);
    const coinTrigger = getLuaRestoreLegalActions(restoredCoinTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === fool.uid);
    expect(coinTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredCoinTrigger, 0), null, 2)).toBeDefined();
    applyRestored(restoredCoinTrigger, coinTrigger!);
    passRestoredChain(restoredCoinTrigger);

    expect(restoredCoinTrigger.session.state.lastCoinResults).toEqual([1]);
    expect(restoredCoinTrigger.session.state.effects.filter((effect) => effect.sourceUid === fool.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
    }))).toEqual([
      { category: undefined, code: 42, event: "continuous", property: undefined, range: ["monsterZone"], targetRange: undefined },
      { category: undefined, code: 14, event: "continuous", property: undefined, range: ["monsterZone"], targetRange: undefined },
      { category: categoryCoin, code: 1100, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined },
      { category: categoryCoin, code: 1102, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined },
      { category: categoryCoin, code: 1101, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined },
      { category: undefined, code: 2, event: "continuous", property: undefined, range: ["monsterZone"], targetRange: [12, 12] },
      { category: undefined, code: 1020, event: "continuous", property: undefined, range: ["monsterZone"], targetRange: undefined },
      { category: undefined, code: 141, event: "continuous", property: undefined, range: ["monsterZone"], targetRange: [12, 12] },
      { category: undefined, code: 3682106, event: "continuous", property: 394240, range: ["monsterZone"], targetRange: undefined },
    ]);

    const restoredAfterCoin = restoreDuelWithLuaScripts(serializeDuel(restoredCoinTrigger.session), source, reader);
    expectCleanRestore(restoredAfterCoin);
    expectRestoredLegalActions(restoredAfterCoin, 0);
    const spellAction = getLuaRestoreLegalActions(restoredAfterCoin, 0).find((action) => action.type === "activateEffect" && action.uid === targetingSpell.uid);
    expect(spellAction, JSON.stringify(getLuaRestoreLegalActions(restoredAfterCoin, 0), null, 2)).toBeDefined();
    applyRestored(restoredAfterCoin, spellAction!);
    expectCleanRestore(restoredAfterCoin);
    expectRestoredLegalActions(restoredAfterCoin, 0);
    expect(restoredAfterCoin.host.messages).not.toContain("arcana fool targeting spell resolved");
    expect(restoredAfterCoin.session.state.chain).toEqual([]);
    expect(restoredAfterCoin.session.state.cards.find((card) => card.uid === fool.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
    });
    expect(restoredAfterCoin.session.state.cards.find((card) => card.uid === targetingSpell.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: fool.uid,
      reasonEffectId: 6,
    });
    expect(restoredAfterCoin.session.state.eventHistory.filter((event) => ["normalSummoned", "coinTossed", "becameTarget", "chainNegated", "chainDisabled", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: fool.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: fool.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: fool.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
        relatedEffectId: 6,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: targetingSpell.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: fool.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
        relatedEffectId: 6,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
        relatedEffectId: 6,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcana Force 0 - The Fool");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_CHANGE_POSITION)");
  expect(script).toContain("e3:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("s.arcanareg(c,Arcana.TossCoin(c,tp))");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVING)");
  expect(script).toContain("e3:SetCode(EFFECT_SELF_DESTROY)");
  expect(script).toContain("Arcana.RegisterCoinResult(c,coin)");
  expect(script).toContain("Arcana.GetCoinResult(ec)");
  expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("Duel.NegateEffect(ev)");
  expect(script).toContain("Duel.Destroy(re:GetHandler(),REASON_EFFECT)");
}

function targetingSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
        if chkc then return chkc:IsOnField() and chkc:IsCode(${foolCode}) end
        if chk==0 then return Duel.IsExistingTarget(Card.IsCode,tp,LOCATION_MZONE,0,1,nil,${foolCode}) end
        local g=Duel.SelectTarget(tp,Card.IsCode,tp,LOCATION_MZONE,0,1,1,nil,${foolCode})
        Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,tp,LOCATION_MZONE)
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstTarget()
        if tc and tc:IsRelateToEffect(e) then
          Debug.Message("arcana fool targeting spell resolved")
          Duel.Destroy(tc,REASON_EFFECT)
        end
      end)
      c:RegisterEffect(e)
    end
  `;
}

function cards(): DuelCardData[] {
  return [
    { code: foolCode, name: "Arcana Force 0 - The Fool", kind: "monster", typeFlags: typeMonster | typeEffect, level: 1, attack: 0, defense: 0 },
    { code: targetingSpellCode, name: "Arcana Fool Targeting Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
