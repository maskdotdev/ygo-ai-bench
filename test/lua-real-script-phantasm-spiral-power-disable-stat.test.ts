import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPowerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c61397885.lua"));
const powerCode = "61397885";
const normalCode = "613978850";
const targetCode = "613978851";
const responderCode = "613978852";
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasPowerScript)("Lua real script Phantasm Spiral Power disable stat", () => {
  it("restores face-up Normal-only activation into target ATK/DEF loss and effect disable", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${powerCode}.lua`);
    expect(script).toContain("return Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)>0");
    expect(script).toContain("and not Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,g,1,0,0)");
    expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e3:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e4:SetCode(EFFECT_DISABLE_EFFECT)");

    const cards: DuelCardData[] = [
      { code: powerCode, name: "Phantasm Spiral Power", kind: "trap", typeFlags: 0x4 },
      { code: normalCode, name: "Phantasm Spiral Normal Fixture", kind: "monster", typeFlags: typeMonster | typeNormal, level: 4, attack: 1800, defense: 1500 },
      { code: targetCode, name: "Phantasm Spiral Effect Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2000, defense: 1700 },
      { code: responderCode, name: "Phantasm Spiral Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 61397885, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [powerCode, normalCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const power = requireCard(session, powerCode);
    const normal = requireCard(session, normalCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, power.uid, "spellTrapZone", 0);
    power.position = "faceDown";
    power.faceUp = false;
    power.turnId = 0;
    moveDuelCard(session.state, normal.uid, "monsterZone", 0);
    normal.position = "faceUpAttack";
    normal.faceUp = true;
    moveDuelCard(session.state, target.uid, "monsterZone", 1);
    target.position = "faceUpAttack";
    target.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(powerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === power.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: power.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetFieldIds: [7],
        targetUids: [target.uid],
        operationInfos: [{ category: 0x4000, count: 1, parameter: 0, player: 0, targetUids: [target.uid] }],
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: power.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetFieldIds: [7],
        targetUids: [target.uid],
        operationInfos: [{ category: 0x4000, count: 1, parameter: 0, player: 0, targetUids: [target.uid] }],
      },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    const restoredTarget = restored.session.state.cards.find((card) => card.uid === target.uid);
    expect(restoredTarget).toBeDefined();
    expect(currentAttack(restoredTarget, restored.session.state)).toBe(1000);
    expect(currentDefense(restoredTarget, restored.session.state)).toBe(700);
    expect(isCardDisabled(restored.session.state, restoredTarget!, (effect, sourceCard, targetCard) =>
      createEffectContext(restored.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === target.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", reset: { flags: 1107169792 }, value: -1000 },
      { code: 104, event: "continuous", reset: { flags: 1107169792 }, value: -1000 },
      { code: 2, event: "continuous", reset: { flags: 1107169792 }, value: undefined },
      { code: 8, event: "continuous", reset: { flags: 1107169792 }, value: 131072 },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === power.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "chainNegated" || event.eventName === "cardsDrawn")).toEqual([]);
    expect(restored.host.messages).not.toContain("phantasm spiral responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("phantasm spiral responder resolved") end)
      c:RegisterEffect(e)
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
