import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost, type LuaScriptSource } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua battle target value callbacks", () => {
  it("applies aux.imval1 attacker immunity checks to battle target locks before and after restore", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Immune Battle Target Callback Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1000 },
      { code: "500", name: "Vulnerable Battle Target Callback Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1000 },
      { code: "200", name: "Battle Target Lock Source", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: "300", name: "Protected Battle Target A", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: "400", name: "Protected Battle Target B", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 170, startingHandSize: 5, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "500"] }, 1: { main: ["200", "300", "400"] } });
    startDuel(session);

    const immuneAttacker = session.state.cards.find((card) => card.code === "100");
    const vulnerableAttacker = session.state.cards.find((card) => card.code === "500");
    const lockSource = session.state.cards.find((card) => card.code === "200");
    const protectedTargetA = session.state.cards.find((card) => card.code === "300");
    const protectedTargetB = session.state.cards.find((card) => card.code === "400");
    expect(immuneAttacker).toBeDefined();
    expect(vulnerableAttacker).toBeDefined();
    expect(lockSource).toBeDefined();
    expect(protectedTargetA).toBeDefined();
    expect(protectedTargetB).toBeDefined();
    for (const card of [immuneAttacker!, vulnerableAttacker!, lockSource!, protectedTargetA!, protectedTargetB!]) {
      const moved = moveDuelCard(session.state, card.uid, "monsterZone", card.controller);
      moved.faceUp = true;
      moved.position = "faceUpAttack";
    }

    const source = battleTargetValueCallbackSource();
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 70, sourceUid: lockSource!.uid }),
        expect.objectContaining({ event: "continuous", code: 1, sourceUid: immuneAttacker!.uid }),
      ]),
    );

    applyAndAssert(session, getLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    expectAttackTarget(session, immuneAttacker!.uid, protectedTargetA!.uid, true);
    expectAttackTarget(session, immuneAttacker!.uid, protectedTargetB!.uid, true);
    expectAttackTarget(session, vulnerableAttacker!.uid, protectedTargetA!.uid, false);
    expectAttackTarget(session, vulnerableAttacker!.uid, protectedTargetB!.uid, false);
    expectAttackTarget(session, vulnerableAttacker!.uid, lockSource!.uid, true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 70, sourceUid: lockSource!.uid }),
        expect.objectContaining({ event: "continuous", code: 1, sourceUid: immuneAttacker!.uid }),
      ]),
    );
    expectAttackTarget(restored.session, immuneAttacker!.uid, protectedTargetA!.uid, true);
    expectAttackTarget(restored.session, immuneAttacker!.uid, protectedTargetB!.uid, true);
    expectAttackTarget(restored.session, vulnerableAttacker!.uid, protectedTargetA!.uid, false);
    expectAttackTarget(restored.session, vulnerableAttacker!.uid, protectedTargetB!.uid, false);
    expectAttackTarget(restored.session, vulnerableAttacker!.uid, lockSource!.uid, true);
  });

  it("restores temporary battle target selection locks with not-handler value callbacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Target Selection Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1000 },
      { code: "200", name: "Selectable Special Summoned Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: "300", name: "Locked Other Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 171, startingHandSize: 2, cardReader: reader });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300"] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === "100");
    const selectableTarget = session.state.cards.find((card) => card.code === "200");
    const lockedTarget = session.state.cards.find((card) => card.code === "300");
    expect(attacker).toBeDefined();
    expect(selectableTarget).toBeDefined();
    expect(lockedTarget).toBeDefined();
    for (const card of [attacker!, selectableTarget!, lockedTarget!]) {
      const moved = moveDuelCard(session.state, card.uid, "monsterZone", card.controller);
      moved.faceUp = true;
      moved.position = "faceUpAttack";
    }
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local sc=Duel.GetFieldCard(1,LOCATION_MZONE,0)
      local tp=sc:GetControler()
      local e=Effect.CreateEffect(sc)
      e:SetType(EFFECT_TYPE_FIELD)
      e:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_IGNORE_IMMUNE)
      e:SetCode(EFFECT_CANNOT_SELECT_BATTLE_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetTargetRange(0,LOCATION_MZONE)
      e:SetCondition(function() return sc:IsControler(tp) end)
      e:SetValue(function(e,c) return c~=e:GetHandler() end)
      e:SetReset(RESET_EVENT|RESETS_STANDARD)
      sc:RegisterEffect(e)
      `,
      "temporary-battle-target-selection-lock.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 332,
          sourceUid: selectableTarget!.uid,
          luaConditionDescriptor: "condition:source-controller",
          luaValueDescriptor: "value-card:not-handler",
        }),
      ]),
    );
    expectAttackTarget(session, attacker!.uid, selectableTarget!.uid, true);
    expectAttackTarget(session, attacker!.uid, lockedTarget!.uid, false);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: () => undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 332,
          sourceUid: selectableTarget!.uid,
          luaConditionDescriptor: "condition:source-controller",
          luaValueDescriptor: "value-card:not-handler",
        }),
      ]),
    );
    expectAttackTarget(restored.session, attacker!.uid, selectableTarget!.uid, true);
    expectAttackTarget(restored.session, attacker!.uid, lockedTarget!.uid, false);

    const restoredSelectable = restored.session.state.cards.find((card) => card.uid === selectableTarget!.uid);
    expect(restoredSelectable).toBeDefined();
    restoredSelectable!.controller = 0;
    expectAttackTarget(restored.session, attacker!.uid, lockedTarget!.uid, true);
  });
});

function battleTargetValueCallbackSource(): LuaScriptSource {
  return {
    readScript(name) {
      if (name === "c100.lua") return battleTargetImmunityScript();
      if (name === "c200.lua") return battleTargetLockScript();
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
