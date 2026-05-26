import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const chaliceCode = "25789292";
const hasChaliceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chaliceCode}.lua`));
const targetCode = "257892920";
const responderCode = "257892921";
const attackerCode = "257892922";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasChaliceScript)("Lua real script Forbidden Chalice stat disable", () => {
  it("restores free-chain target disable plus temporary ATK gain after response-window restore", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${chaliceCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DISABLE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,g,1,0,0)");
    expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(400)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e3:SetCode(EFFECT_DISABLE_EFFECT)");

    const cards: DuelCardData[] = [
      { code: chaliceCode, name: "Forbidden Chalice", kind: "spell", typeFlags: typeSpell },
      { code: targetCode, name: "Forbidden Chalice Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
      { code: responderCode, name: "Forbidden Chalice Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: attackerCode, name: "Forbidden Chalice Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 25789292, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [chaliceCode, attackerCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const chalice = requireCard(session, chaliceCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    const attacker = requireCard(session, attackerCode);
    moveDuelCard(session.state, chalice.uid, "hand", 0);
    moveDuelCard(session.state, attacker.uid, "monsterZone", 0);
    attacker.position = "faceUpAttack";
    attacker.faceUp = true;
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
    expect(host.loadCardScript(Number(chaliceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === chalice.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    const activated = applyResponse(session, activate!);
    expect(activated.ok, activated.error).toBe(true);
    expect(activated.legalActions).toEqual(getLegalActions(session, 1));
    expect(activated.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 1));
    expect(activated.legalActionGroups.flatMap((group) => group.actions)).toEqual(activated.legalActions);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: chalice.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [6],
        targetUids: [attacker.uid],
        operationInfos: [{ category: 0x4000, count: 1, parameter: 0, player: 0, targetUids: [attacker.uid] }],
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: chalice.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [6],
        targetUids: [attacker.uid],
        operationInfos: [{ category: 0x4000, count: 1, parameter: 0, player: 0, targetUids: [attacker.uid] }],
      },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    const restoredTarget = requireCard(restored.session, targetCode);
    const restoredAttacker = requireCard(restored.session, attackerCode);
    expect(currentAttack(restoredAttacker, restored.session.state)).toBe(2400);
    expect(isCardDisabled(restored.session.state, restoredAttacker, (effect, sourceCard, targetCard) =>
      createEffectContext(restored.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", reset: { flags: 1107169792 }, value: 400 },
      { code: 2, event: "continuous", reset: { flags: 1107169792 }, value: undefined },
      { code: 8, event: "continuous", reset: { flags: 1107169792 }, value: 131072 },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === chalice.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "chainNegated")).toEqual([]);
    expect(restored.host.messages).not.toContain("forbidden chalice responder resolved");

    restored.session.state.phase = "battle";
    restored.session.state.waitingFor = 0;
    const attack = getLegalActions(restored.session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === target.uid);
    expect(attack).toBeDefined();
    const attackResponse = applyResponse(restored.session, attack!);
    expect(attackResponse.ok, attackResponse.error).toBe(true);
    passBattleResponses(restored.session);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 600 });
    expect(restored.session.state.players[1].lifePoints).toBe(7400);
    expect(restored.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "graveyard" });
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
      e:SetOperation(function(e,tp) Debug.Message("forbidden chalice responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    const response = applyResponse(session, pass!);
    expect(response.ok, response.error).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
