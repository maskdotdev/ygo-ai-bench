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
const magicianCode = "8396952";
const spellCode = "83969520";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMagicianScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${magicianCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const categoryCoin = 0x1000000;
const effectSetAttackFinal = 102;
const eventChainSolved = 1022;

describe.skipIf(!hasUpstreamScripts || !hasMagicianScript)("Lua real script Arcana Force Magician coin spell stat", () => {
  it("restores summon TossCoin registration into Spell chain-solved stat or recovery branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const source = fixtureSource(workspace);
    const script = workspace.readScript(`official/c${magicianCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 8396952, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [magicianCode, spellCode] }, 1: { main: [] } });
    startDuel(session);

    const magician = requireCard(session, magicianCode);
    const spell = requireCard(session, spellCode);
    moveDuelCard(session.state, magician.uid, "hand", 0);
    const setSpell = moveDuelCard(session.state, spell.uid, "spellTrapZone", 0);
    setSpell.sequence = 0;
    setSpell.faceUp = false;
    setSpell.position = "faceDown";
    session.state.players[1].lifePoints = 5000;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(magicianCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(spellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === magician.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestored(restoredOpen, summon!);

    const restoredCoin = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredCoin);
    expectRestoredLegalActions(restoredCoin, 0);
    const coinTrigger = getLuaRestoreLegalActions(restoredCoin, 0).find((action) => action.type === "activateTrigger" && action.uid === magician.uid);
    expect(coinTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredCoin, 0), null, 2)).toBeDefined();
    applyRestored(restoredCoin, coinTrigger!);
    passRestoredChain(restoredCoin);

    expect(restoredCoin.session.state.lastCoinResults).toHaveLength(1);
    expect([0, 1]).toContain(restoredCoin.session.state.lastCoinResults[0]);
    expect(restoredCoin.session.state.effects.filter((effect) => effect.sourceUid === magician.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryCoin, code: 1100, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "normalSummoned" },
      { category: categoryCoin, code: 1102, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned" },
      { category: categoryCoin, code: 1101, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "flipSummoned" },
      { category: undefined, code: eventChainSolved, event: "continuous", range: ["monsterZone"], triggerEvent: undefined },
    ]);

    const spellActivation = getLuaRestoreLegalActions(restoredCoin, 0).find((action) => action.type === "activateEffect" && action.uid === spell.uid);
    expect(spellActivation, JSON.stringify(getLuaRestoreLegalActions(restoredCoin, 0), null, 2)).toBeDefined();
    applyRestored(restoredCoin, spellActivation!);
    passRestoredChain(restoredCoin);

    const coin = restoredCoin.session.state.lastCoinResults[0];
    if (coin === 1) {
      expect(currentAttack(findCard(restoredCoin.session, magician.uid), restoredCoin.session.state)).toBe(2200);
      expect(restoredCoin.session.state.effects.filter((effect) => effect.sourceUid === magician.uid && effect.code === effectSetAttackFinal).map((effect) => ({
        code: effect.code,
        event: effect.event,
        reset: effect.reset,
        value: effect.value,
      }))).toEqual([
        { code: effectSetAttackFinal, event: "continuous", reset: { flags: 1107235328 }, value: 2200 },
      ]);
    } else {
      expect(restoredCoin.session.state.players[1].lifePoints).toBe(5500);
    }
    expect(restoredCoin.session.state.eventHistory.filter((event) => ["normalSummoned", "coinTossed", "chainSolved", "recoveredLifePoints"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: magician.uid,
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
        eventReasonCardUid: magician.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "chainSolved",
        eventCode: eventChainSolved,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
        relatedEffectId: 1,
      },
      {
        eventName: "chainSolved",
        eventCode: eventChainSolved,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-7",
        relatedEffectId: 4,
      },
      ...(coin === 0 ? [{
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: magician.uid,
        eventReasonEffectId: 4,
      }] : []),
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcana Force I - The Magician");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("s.arcanareg(c,Arcana.TossCoin(c,tp))");
  expect(script).toContain("e1:SetCode(EVENT_CHAIN_SOLVED)");
  expect(script).toContain("Arcana.RegisterCoinResult(c,coin)");
  expect(script).toContain("re:IsSpellEffect()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(c:GetBaseAttack()*2)");
  expect(script).toContain("Duel.Recover(1-tp,500,REASON_EFFECT)");
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${spellCode}.lua`) return spellScript();
      return workspace.readScript(name);
    },
  };
}

function spellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      c:RegisterEffect(e)
    end
  `;
}

function cards(): DuelCardData[] {
  return [
    { code: magicianCode, name: "Arcana Force I - The Magician", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1100, defense: 1100 },
    { code: spellCode, name: "Magician Chain Solved Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
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
