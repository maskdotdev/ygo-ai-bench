import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { CardPosition, DuelCardData, DuelSession } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

type FieldMoveRestoreCase = {
  label: string;
  seed: number;
  targetLocation: string;
  operation: string;
  expectedLocation: "monsterZone" | "spellTrapZone";
  expectedPosition: CardPosition;
  targetKind?: DuelCardData["kind"];
  targetTypeFlags?: number;
  setup?: (session: DuelSession) => void;
};

const cases: FieldMoveRestoreCase[] = [
  {
    label: "MoveToField",
    seed: 189,
    targetLocation: "LOCATION_HAND",
    operation: "Duel.MoveToField(target, 0, 0, LOCATION_MZONE, POS_FACEUP_ATTACK, true)",
    expectedLocation: "monsterZone",
    expectedPosition: "faceUpAttack",
  },
  {
    label: "ActivateFieldSpell",
    seed: 191,
    targetLocation: "LOCATION_HAND",
    operation: "Duel.ActivateFieldSpell(target, nil, 0)",
    expectedLocation: "spellTrapZone",
    expectedPosition: "faceUpAttack",
    targetKind: "spell",
    targetTypeFlags: 0x80002,
  },
  {
    label: "ReturnToField",
    seed: 190,
    targetLocation: "LOCATION_REMOVED",
    operation: "Duel.ReturnToField(target, POS_FACEUP_DEFENSE)",
    expectedLocation: "monsterZone",
    expectedPosition: "faceUpDefense",
    setup(session: DuelSession) {
      const target = session.state.cards.find((card) => card.code === "200");
      expect(target).toBeDefined();
      moveDuelCard(session.state, target!.uid, "monsterZone", 0);
      target!.position = "faceUpAttack";
      target!.faceUp = true;
      moveDuelCard(session.state, target!.uid, "banished", 0);
    },
  },
];

describe("Lua field move restore helpers", () => {
  it.each(cases)("restores $label missed timing after later event boundaries", ({ label, seed, targetLocation, operation, expectedLocation, expectedPosition, targetKind, targetTypeFlags, setup }) => {
    const targetCard: DuelCardData = { code: "200", name: `Restore ${label} Target`, kind: targetKind ?? "monster" };
    if (targetTypeFlags !== undefined) targetCard.typeFlags = targetTypeFlags;
    const cards: DuelCardData[] = [
      { code: "100", name: `Restore ${label} Source`, kind: "monster" },
      targetCard,
      { code: "300", name: `Restore When ${label} Watcher`, kind: "monster" },
      { code: "400", name: `Restore If ${label} Watcher`, kind: "monster" },
      { code: "500", name: `Restore ${label} Damage Watcher`, kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp)
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, ${targetLocation}, 0, 1, 1, nil):GetFirst()
              ${operation}
              Duel.Damage(1, 100, REASON_EFFECT)
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c300.lua") {
          return `
          c300={}
          function c300.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_MOVE)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("when ${label} move resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c400.lua") {
          return `
          c400={}
          function c400.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_MOVE)
            e:SetProperty(EFFECT_FLAG_DELAY)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("if ${label} move resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c500.lua") {
          return `
          c500={}
          function c500.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_DAMAGE)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("${label} damage boundary resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);
    setup?.(session);

    const host = createLuaScriptHost(session);
    for (const code of [100, 300, 400, 500]) {
      const loaded = host.loadCardScript(code, source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(4);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1030");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1030", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "moved", eventCode: 1030 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ controller: 0, location: expectedLocation, position: expectedPosition });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPendingEffectIds = restored.session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(restoredPendingEffectIds).not.toContain("lua-2-1030");
    expect(restoredPendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1030", "lua-4-1111"]));
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    expect(hasGroupedTrigger(restored, "lua-3-1030")).toBe(true);
    expect(hasGroupedTrigger(restored, "lua-4-1111")).toBe(true);
    expect(hasGroupedTrigger(restored, "lua-2-1030")).toBe(false);
  });
});

function applyAndAssert(session: DuelSession, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function hasGroupedTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, effectId: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, 0).some((group) => group.actions.some((action) => action.type === "activateTrigger" && action.effectId === effectId));
}
