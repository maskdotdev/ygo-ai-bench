import { expect } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

export function setupRestoredBattleQuick(property: "EFFECT_FLAG_DAMAGE_STEP" | "EFFECT_FLAG_DAMAGE_CAL") {
  const cards: DuelCardData[] = [
    { code: "100", name: "Restore Battle Priority Attacker", kind: "monster", attack: 1800 },
    { code: "300", name: "Restore Battle Priority Quick", kind: "monster" },
    { code: "400", name: "Restore Battle Chain Quick", kind: "monster" },
    { code: "500", name: "Restore Opponent Battle Quick", kind: "monster" },
  ];
  const source = {
    readScript(name: string) {
      if (name === "c300.lua") {
        return `
        c300={}
        function c300.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_QUICK_O)
          e:SetProperty(${property})
          e:SetRange(LOCATION_HAND)
          e:SetCondition(function(e,tp) return Duel.GetCurrentChain()==0 end)
          e:SetOperation(function(e,tp) Debug.Message("restored battle quick resolved") end)
          c:RegisterEffect(e)
        end
        `;
      }
      if (name === "c400.lua") {
        return `
        c400={}
        function c400.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_QUICK_O)
          e:SetProperty(${property})
          e:SetRange(LOCATION_HAND)
          e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
          e:SetOperation(function(e,tp) Debug.Message("restored chain-only battle quick resolved") end)
          c:RegisterEffect(e)
        end
        `;
      }
      if (name === "c500.lua") {
        return `
        c500={}
        function c500.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_QUICK_O)
          e:SetProperty(${property})
          e:SetRange(LOCATION_HAND)
          e:SetCondition(function(e,tp) return Duel.GetCurrentChain()==0 end)
          e:SetOperation(function(e,tp) Debug.Message("restored opponent battle quick resolved") end)
          c:RegisterEffect(e)
        end
        `;
      }
      return undefined;
    },
  };
  const session = createDuel({ seed: property === "EFFECT_FLAG_DAMAGE_STEP" ? 56 : 57, startingHandSize: 2, cardReader: createCardReader(cards) });
  loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: ["400", "500"] } });
  startDuel(session);

  const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
  expect(attacker).toBeDefined();
  moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

  const host = createLuaScriptHost(session);
  const quickScript = host.loadCardScript(300, source);
  const chainQuickScript = host.loadCardScript(400, source);
  const opponentQuickScript = host.loadCardScript(500, source);
  expect(quickScript.ok, quickScript.error).toBe(true);
  expect(chainQuickScript.ok, chainQuickScript.error).toBe(true);
  expect(opponentQuickScript.ok, opponentQuickScript.error).toBe(true);
  expect(host.registerInitialEffects()).toBe(3);

  const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
  expect(battle).toBeDefined();
  applyAndAssert(session, battle!);
  const attack = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined);
  expect(attack).toBeDefined();
  applyAndAssert(session, attack!);
  passBattleResponse(session, 1, "passAttack");
  passBattleResponse(session, 0, "passAttack");
  expect(session.state.battleWindow?.kind).toBe("startDamageStep");
  return { cards, session, source };
}

export function activateTurnQuick(fixture: ReturnType<typeof setupRestoredBattleQuick>): void {
  const quick = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "activateEffect");
  expect(quick).toBeDefined();
  const result = applyAndAssert(fixture.session, quick!);
  expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
}

export function passBattleResponse(session: ReturnType<typeof createDuel>, player: 0 | 1, type: "passAttack" | "passDamage"): void {
  const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === type);
  if (!pass) return;
  applyAndAssert(session, pass!);
}

export function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

export function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  assertLuaRestoreLegalWindow(restored, response, response.state.waitingFor!);
  return response;
}

export function assertLuaRestoreLegalWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: ReturnType<typeof applyLuaRestoreResponse>, player: 0 | 1): void {
  const windowId = restored.session.state.actionWindowId;
  const publicState = queryPublicState(restored.session);
  expect(response.state.actionWindowId).toBe(windowId);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(response.state).not.toHaveProperty("triggerOrderPrompt");
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  for (const legalAction of response.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: response.state.windowKind });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: response.state.windowKind });
}

export function hasGroupedLuaEffect(
  groups: ReturnType<typeof getLuaRestoreLegalActionGroups>,
  player: 0 | 1,
  code: string,
  windowKind: "battle" | "chainResponse",
): boolean {
  return groups.some((group) =>
    group.windowKind === windowKind && group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.uid.includes(code) && action.windowKind === windowKind),
  );
}

export function hasGroupedPass(groups: ReturnType<typeof getLuaRestoreLegalActionGroups>, player: 0 | 1): boolean {
  return groups.some(
    (group) =>
      group.windowKind === "chainResponse" &&
      group.actions.some((action) => action.type === "passChain" && action.player === player && action.windowId === group.windowId && action.windowKind === "chainResponse"),
  );
}
