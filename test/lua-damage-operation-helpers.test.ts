import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua damage operation helpers", () => {
  it("lets Lua scripts detect effect damage operation info", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Damage Condition Probe", kind: "monster" }];
    const session = createDuel({ seed: 160, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(c)
      Duel.SetOperationInfo(3,CATEGORY_DAMAGE,nil,1,1,500)
      Debug.Message("damcon damage " .. tostring(aux.damcon1(e,1,nil,0,3,nil,0,0)) .. "/" .. tostring(aux.damcon1(e,0,nil,0,3,nil,0,0)))
      local reverse_damage=Effect.GlobalEffect()
      reverse_damage:SetType(EFFECT_TYPE_FIELD)
      reverse_damage:SetCode(EFFECT_REVERSE_DAMAGE)
      reverse_damage:SetTargetRange(1,0)
      Duel.RegisterEffect(reverse_damage,0)
      Duel.SetOperationInfo(4,CATEGORY_DAMAGE,nil,1,0,900)
      Debug.Message("damcon reverse damage blocked " .. tostring(aux.damcon1(e,0,nil,0,4,nil,0,0)))
      local reverse_recover=Effect.GlobalEffect()
      reverse_recover:SetType(EFFECT_TYPE_FIELD)
      reverse_recover:SetCode(EFFECT_REVERSE_RECOVER)
      reverse_recover:SetTargetRange(1,0)
      Duel.RegisterEffect(reverse_recover,1)
      Duel.SetOperationInfo(5,CATEGORY_RECOVER,nil,1,1,700)
      Debug.Message("damcon recover reversed " .. tostring(aux.damcon1(e,1,nil,0,5,nil,0,0)))
      local no_damage=Effect.GlobalEffect()
      no_damage:SetType(EFFECT_TYPE_FIELD)
      no_damage:SetCode(EFFECT_NO_EFFECT_DAMAGE)
      no_damage:SetTargetRange(1,0)
      Duel.RegisterEffect(no_damage,0)
      Duel.SetOperationInfo(6,CATEGORY_DAMAGE,nil,1,0,900)
      Debug.Message("damcon no damage blocked " .. tostring(aux.damcon1(e,0,nil,0,6,nil,0,0)))
      `,
      "damage-condition.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("damcon damage true/false");
    expect(host.messages).toContain("damcon reverse damage blocked false");
    expect(host.messages).toContain("damcon recover reversed true");
    expect(host.messages).toContain("damcon no damage blocked false");
  });

  it("lets Lua scripts record attack cost payment status", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cost Attacker", kind: "monster", attack: 1800 },
      { code: "200", name: "Cost Target", kind: "monster", attack: 1000 },
    ];
    const session = createDuel({ seed: 79, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "200");
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";

    const host = createLuaScriptHost(session);
    expect(applyResponse(session, { type: "declareAttack", player: 0, attackerUid: attacker!.uid, targetUid: target!.uid, label: "Attack" }).ok).toBe(true);
    const result = host.loadScript(
      `
      Debug.Message("attack cost initial " .. Duel.IsAttackCostPaid())
      Duel.AttackCostPaid()
      Debug.Message("attack cost paid " .. Duel.IsAttackCostPaid())
      Duel.AttackCostPaid(2)
      Debug.Message("attack cost canceled " .. Duel.IsAttackCostPaid())
      Duel.AttackCostPaid(9)
      Debug.Message("attack cost clamped " .. Duel.IsAttackCostPaid())
      `,
      "attack-cost-paid.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["attack cost initial 0", "attack cost paid 1", "attack cost canceled 2", "attack cost clamped 2"]);
    expect(session.state.attackCostPaid).toBe(2);
    expect(restoreDuel(serializeDuel(session), createCardReader(cards)).state.attackCostPaid).toBe(2);
    passBattleResponses(session);
    expect(session.state.attackCostPaid).toBe(0);
  });
});

function passBattleResponses(session: ReturnType<typeof createDuel>): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === passType);
    expect(pass).toBeDefined();
    const result = applyResponse(session, pass!);
    expect(result.ok, result.error).toBe(true);
  }
}
