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
const crackingCode = "60349525";
const summonedCode = "603495250";
const responderCode = "603495251";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCrackingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${crackingCode}.lua`));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasCrackingScript)("Lua real script Cracking Dragon summon stat damage", () => {
  it("restores opponent summon stat loss, AdjustInstantly delta damage, and battle indestructible gate", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${crackingCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("return c:IsLevelBelow(e:GetHandler():GetLevel())");
    expect(script).toContain("e2a:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DAMAGE)");
    expect(script).toContain("e2a:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e2a:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e2b:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("sc:CreateEffectRelation(e)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,sc,1,tp,val)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,val)");
    expect(script).toContain("Duel.AdjustInstantly(sc)");
    expect(script).toContain("Duel.Damage(1-tp,atk_diff,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: crackingCode, name: "Cracking Dragon", kind: "monster", typeFlags: typeMonster, level: 8, attack: 3000, defense: 0 },
      { code: summonedCode, name: "Cracking Dragon Summoned Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Cracking Dragon Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 60349525, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [crackingCode] }, 1: { main: [summonedCode, responderCode] } });
    startDuel(session);

    const cracking = requireCard(session, crackingCode);
    const summoned = requireCard(session, summonedCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, cracking.uid, 0);
    moveDuelCard(session.state, summoned.uid, "hand", 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(crackingCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const summon = getLegalActions(session, 1).find((action) => action.type === "normalSummon" && action.uid === summoned.uid);
    expect(summon, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, summon!);
    expect(session.state.pendingTriggers).toMatchObject([
      {
        eventCardUid: summoned.uid,
        eventCode: 1100,
        eventName: "normalSummoned",
        player: 0,
        sourceUid: cracking.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === cracking.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-2-1100",
        sourceUid: cracking.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: summoned.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [
          { category: 0x200000, count: 1, parameter: 800, player: 0, targetUids: [summoned.uid] },
          { category: 0x80000, count: 0, parameter: 800, player: 1, targetUids: [] },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredChain);

    expect(restoredChain.host.messages).not.toContain("cracking dragon responder resolved");
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7200);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === summoned.uid), restoredChain.session.state)).toBe(1000);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cracking.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned")).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: summoned.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, uid: string, player: PlayerId): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
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
      e:SetOperation(function(e,tp) Debug.Message("cracking dragon responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    applyRestoredAction(restored, pass!);
  }
}
