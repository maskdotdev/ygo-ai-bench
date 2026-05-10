import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua dynamic battle traits", () => {
  it("uses current monster type for attack legal actions and Lua battle helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Dynamic Non-Monster Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1200 },
    ];
    const source = { readScript: dynamicBattleTraitScript };
    const session = createDuel({ seed: 105, startingHandSize: 0, drawPerTurn: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid)).toBe(false);

    const result = host.loadScript(
      `
      local c=Duel.GetFieldCard(0,LOCATION_MZONE,0)
      local g,direct=c:GetAttackableTarget()
      Debug.Message("dynamic battle attackable " .. tostring(c:IsMonster()) .. "/" .. tostring(c:CanAttack()) .. "/" .. g:GetCount() .. "/" .. tostring(direct))
      `,
      "dynamic-battle-attackable.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("dynamic battle attackable false/false/0/false");
  });
});

function dynamicBattleTraitScript(name: string): string | undefined {
  if (name !== "c100.lua") return undefined;
  return `
    c100={}
    function c100.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_REMOVE_TYPE)
      e:SetValue(TYPE_MONSTER)
      c:RegisterEffect(e)
    end
  `;
}
