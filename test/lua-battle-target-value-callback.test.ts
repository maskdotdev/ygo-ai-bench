import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost, type LuaScriptSource } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua battle target value callbacks", () => {
  it("applies aux.imval1 immunity checks to battle target locks before and after restore", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Target Callback Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1000 },
      { code: "200", name: "Battle Target Lock Source", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: "300", name: "Immune Battle Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: "400", name: "Vulnerable Battle Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 170, startingHandSize: 4, cardReader: reader });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300", "400"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === "100");
    const lockSource = session.state.cards.find((card) => card.code === "200");
    const immuneTarget = session.state.cards.find((card) => card.code === "300");
    const vulnerableTarget = session.state.cards.find((card) => card.code === "400");
    expect(attacker).toBeDefined();
    expect(lockSource).toBeDefined();
    expect(immuneTarget).toBeDefined();
    expect(vulnerableTarget).toBeDefined();
    for (const card of [attacker!, lockSource!, immuneTarget!, vulnerableTarget!]) {
      const moved = moveDuelCard(session.state, card.uid, "monsterZone", card.controller);
      moved.faceUp = true;
      moved.position = "faceUpAttack";
    }

    const source = battleTargetValueCallbackSource();
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 70, sourceUid: lockSource!.uid }),
        expect.objectContaining({ event: "continuous", code: 1, sourceUid: immuneTarget!.uid }),
      ]),
    );

    applyAndAssert(session, getLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    expectAttackTarget(session, attacker!.uid, immuneTarget!.uid, true);
    expectAttackTarget(session, attacker!.uid, vulnerableTarget!.uid, false);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 70, sourceUid: lockSource!.uid }),
        expect.objectContaining({ event: "continuous", code: 1, sourceUid: immuneTarget!.uid }),
      ]),
    );
    expectAttackTarget(restored.session, attacker!.uid, immuneTarget!.uid, true);
    expectAttackTarget(restored.session, attacker!.uid, vulnerableTarget!.uid, false);
  });
});

function battleTargetValueCallbackSource(): LuaScriptSource {
  return {
    readScript(name) {
      if (name === "c200.lua") return battleTargetLockScript();
      if (name === "c300.lua") return battleTargetImmunityScript();
      return undefined;
    },
  };
}

function battleTargetLockScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_FIELD)
      e:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetTargetRange(LOCATION_MZONE,LOCATION_MZONE)
      e:SetTarget(s.tg)
      e:SetValue(aux.imval1)
      c:RegisterEffect(e)
    end
    function s.tg(e,c)
      return c:IsCode(300) or c:IsCode(400)
    end
  `;
}

function battleTargetImmunityScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_IMMUNE_EFFECT)
      e:SetRange(LOCATION_MZONE)
      e:SetValue(function(e,te) return te and te:GetHandler():IsCode(200) end)
      c:RegisterEffect(e)
    end
  `;
}

function expectAttackTarget(session: DuelSession, attackerUid: string, targetUid: string, present: boolean): void {
  const attacks = getLegalActions(session, 0).filter((action) => action.type === "declareAttack");
  expect(attacks.some((action) => action.attackerUid === attackerUid && action.targetUid === targetUid), JSON.stringify(attacks)).toBe(present);
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
