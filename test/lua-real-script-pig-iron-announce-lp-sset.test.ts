import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPigIronScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c46497537.lua"));
const pigIronCode = "46497537";
const targetCode = "464975370";
const typeMonster = 0x1;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasPigIronScript)("Lua real script Pig Iron AnnounceNumber LP SSet", () => {
  it("restores dynamic AnnounceNumber LP payment, stat reset, and graveyard self-set", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${pigIronCode}.lua`);
    expect(script).toContain("Duel.AnnounceNumber(tp,table.unpack(t))");
    expect(script).toContain("Duel.PayLPCost(tp,value)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL_FINAL)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_LEAVE_GRAVE,c,1,0,0)");
    expect(script).toContain("Duel.SSet(tp,c)");

    const cards: DuelCardData[] = [
      { code: pigIronCode, name: "Pig Iron vs. Pen Peg", kind: "trap", typeFlags: typeTrap },
      { code: targetCode, name: "Pig Iron Boosted Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${targetCode}.lua`) return boostedTargetScript();
        return workspace.readScript(name);
      },
    };

    const activationSession = createDuel({ seed: 46497537, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(activationSession, { 0: { main: [pigIronCode, targetCode] }, 1: { main: [] } });
    startDuel(activationSession);
    const pigIron = requireCard(activationSession, pigIronCode);
    const target = requireCard(activationSession, targetCode);
    moveDuelCard(activationSession.state, pigIron.uid, "spellTrapZone", 0);
    pigIron.position = "faceDown";
    pigIron.faceUp = false;
    pigIron.turnId = 0;
    moveDuelCard(activationSession.state, target.uid, "monsterZone", 0);
    target.position = "faceUpAttack";
    target.faceUp = true;
    activationSession.state.phase = "main1";
    activationSession.state.turnPlayer = 0;
    activationSession.state.waitingFor = 0;

    const activationHost = createLuaScriptHost(activationSession, workspace);
    expect(activationHost.loadCardScript(Number(pigIronCode), source).ok).toBe(true);
    expect(activationHost.loadCardScript(Number(targetCode), source).ok).toBe(true);
    expect(activationHost.registerInitialEffects()).toBe(2);
    expect(currentAttack(target, activationSession.state)).toBe(2000);
    expect(currentDefense(target, activationSession.state)).toBe(1500);
    expect(currentLevel(target, activationSession.state)).toBe(6);

    const activate = getLegalActions(activationSession, 0).find((action) => action.type === "activateEffect" && action.uid === pigIron.uid);
    expect(activate, JSON.stringify(getLegalActions(activationSession, 0), null, 2)).toBeDefined();
    applyAndAssert(activationSession, activate!);
    drainDefaultLuaOperationPrompts(activationSession);
    expect(activationSession.state.chain).toEqual([]);
    expect(activationSession.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    const resolvedTarget = activationSession.state.cards.find((card) => card.uid === target.uid);
    expect(currentAttack(resolvedTarget, activationSession.state)).toBe(1500);
    expect(currentDefense(resolvedTarget, activationSession.state)).toBe(1200);
    expect(currentLevel(resolvedTarget, activationSession.state)).toBe(4);
    expect(activationSession.state.players[0].lifePoints).toBe(7900);
    expect(activationHost.promptDecisions).toEqual([
      {
        id: "lua-prompt-1",
        api: "AnnounceNumber",
        player: 0,
        options: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
        descriptions: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
        returned: 100,
      },
    ]);
    expect(activationSession.state.effects.filter((effect) => effect.sourceUid === target.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", reset: undefined, value: 500 },
      { code: 104, event: "continuous", reset: undefined, value: 300 },
      { code: 130, event: "continuous", reset: undefined, value: 2 },
      { code: 102, event: "continuous", reset: { flags: 33427456 }, value: 1500 },
      { code: 106, event: "continuous", reset: { flags: 33427456 }, value: 1200 },
      { code: 314, event: "continuous", reset: { flags: 33427456 }, value: 4 },
    ]);
    expect(activationSession.state.cards.find((card) => card.uid === pigIron.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(activationSession.state.eventHistory.filter((event) => event.eventName === "spellTrapSet")).toEqual([]);
    expect(activationHost.messages).not.toContain("attempt to call a nil value");

    activationSession.state.players[1].lifePoints = 7900;
    const restoredSetWindow = restoreDuelWithLuaScripts(serializeDuel(activationSession), source, reader);
    expectCleanRestore(restoredSetWindow);
    expectRestoredLegalActions(restoredSetWindow, 0);
    const setAction = getLuaRestoreLegalActions(restoredSetWindow, 0).find((action) => action.type === "activateEffect" && action.uid === pigIron.uid);
    expect(setAction, JSON.stringify(getLuaRestoreLegalActions(restoredSetWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetWindow, setAction!);
    expect(restoredSetWindow.session.state.chain).toEqual([]);
    expect(restoredSetWindow.session.state.cards.find((card) => card.uid === pigIron.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      position: "faceDown",
      faceUp: false,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredSetWindow.session.state.eventHistory.filter((event) => event.eventName === "spellTrapSet")).toEqual([
      {
        eventName: "spellTrapSet",
        eventCode: 1107,
        eventCardUid: pigIron.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function boostedTargetScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetCode(EFFECT_UPDATE_ATTACK)
      e1:SetValue(500)
      c:RegisterEffect(e1)
      local e2=e1:Clone()
      e2:SetCode(EFFECT_UPDATE_DEFENSE)
      e2:SetValue(300)
      c:RegisterEffect(e2)
      local e3=e1:Clone()
      e3:SetCode(EFFECT_UPDATE_LEVEL)
      e3:SetValue(2)
      c:RegisterEffect(e3)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function drainDefaultLuaOperationPrompts(session: DuelSession): void {
  for (let index = 0; index < 8 && session.state.prompt?.origin === "luaOperation"; index += 1) {
    const prompt = session.state.prompt;
    const response = getLegalActions(session, prompt.player).find((action) =>
      prompt.type === "selectOption" ? action.type === "selectOption" && action.option === (prompt.options[0] ?? 0) : action.type === "selectYesNo" && action.yes,
    );
    expect(response).toBeDefined();
    const result = applyResponse(session, response);
    expect(result.ok, result.error).toBe(true);
  }
  expect(session.state.prompt?.origin).not.toBe("luaOperation");
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const raw = getLuaRestoreLegalActions(restored, player);
  const grouped = getLuaRestoreLegalActionGroups(restored, player);
  expect(grouped.flatMap((group) => group.actions)).toEqual(raw);
  expect(result.legalActions).toEqual(raw);
  expect(result.legalActionGroups).toEqual(grouped);
}
