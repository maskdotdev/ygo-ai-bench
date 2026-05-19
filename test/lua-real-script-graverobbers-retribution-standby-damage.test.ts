import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const graverobbersCode = "33737664";
const banishedMonsterCode = "33737665";
const banishedSpellCode = "33737666";
const responderCode = "33737667";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Graverobber's Retribution Standby damage", () => {
  it("restores its mandatory Standby trigger and counts opponent face-up banished monsters for damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${graverobbersCode}.lua`);
    expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(script).toContain("return tp==Duel.GetTurnPlayer()");
    expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,0)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER)");
    expect(script).toContain("Duel.GetMatchingGroupCount(s.filter,tp,0,LOCATION_REMOVED,nil)*100");
    expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === graverobbersCode),
      { code: banishedMonsterCode, name: "Retribution Banished Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
      { code: banishedSpellCode, name: "Retribution Banished Spell", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Retribution Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 33737664, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [graverobbersCode] },
      1: { main: [banishedMonsterCode, banishedMonsterCode, banishedMonsterCode, banishedSpellCode, responderCode] },
    });
    startDuel(session);

    const retribution = requireCard(session, graverobbersCode);
    const banishedMonsters = session.state.cards.filter((card) => card.code === banishedMonsterCode);
    const banishedSpell = requireCard(session, banishedSpellCode);
    const responder = requireCard(session, responderCode);
    expect(banishedMonsters).toHaveLength(3);
    moveDuelCard(session.state, retribution.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, banishedMonsters[0]!.uid, "banished", 1).faceUp = true;
    moveDuelCard(session.state, banishedMonsters[1]!.uid, "banished", 1).faceUp = true;
    moveDuelCard(session.state, banishedMonsters[2]!.uid, "banished", 1).faceUp = false;
    moveDuelCard(session.state, banishedSpell.uid, "banished", 1).faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "draw";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(graverobbersCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 0);
    const standby = getLuaRestoreLegalActions(restoredDraw, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDraw, standby!);
    expect(restoredDraw.session.state.phase).toBe("standby");
    expect(restoredDraw.session.state.eventHistory.filter((event) => event.eventName === "phaseStandby")).toEqual([
      { eventName: "phaseStandby", eventCode: 0x1002 },
    ]);
    expect(restoredDraw.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-4098",
        sourceUid: retribution.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "phaseStandby",
        eventCode: 0x1002,
        eventTriggerTiming: "when",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === retribution.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-2-4098",
        sourceUid: retribution.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        eventName: "phaseStandby",
        eventCode: 0x1002,
        eventTriggerTiming: "when",
        operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 0 }],
        targetPlayer: 1,
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.chain).toHaveLength(0);
    expect(restoredChain.session.state.pendingTriggers).toEqual([]);
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7800);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 200,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: retribution.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restoredChain.host.messages).not.toContain("retribution responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("retribution responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
