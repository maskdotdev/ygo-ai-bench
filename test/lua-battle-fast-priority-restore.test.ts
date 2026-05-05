import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua battle fast priority restore", () => {
  it("returns restored damage-step quick chains to the damage response player", () => {
    const fixture = setupRestoredBattleQuick("EFFECT_FLAG_DAMAGE_STEP");
    passBattleResponse(fixture.session, 1, "passDamage");
    activateTurnQuick(fixture);

    const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();

    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleStep: "damage", battleWindow: { kind: "startDamageStep", responsePlayer: 1 } });
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(getDuelLegalActions(restored.session, 0)).toEqual([]);
    expect(restored.host.messages).toEqual(["restored battle quick resolved"]);
  });

  it("returns restored damage-calculation quick chains to the damage-calculation response player", () => {
    const fixture = setupRestoredBattleQuick("EFFECT_FLAG_DAMAGE_CAL");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    expect(fixture.session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    passBattleResponse(fixture.session, 1, "passDamage");
    activateTurnQuick(fixture);

    const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();

    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleStep: "damageCalculation", battleWindow: { kind: "duringDamageCalculation", responsePlayer: 1 } });
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(getDuelLegalActions(restored.session, 0)).toEqual([]);
    expect(restored.host.messages).toEqual(["restored battle quick resolved"]);
  });

  it("resets restored damage-step passes after a Lua quick effect resolves", () => {
    const fixture = setupRestoredBattleQuick("EFFECT_FLAG_DAMAGE_STEP");
    passBattleResponse(fixture.session, 1, "passDamage");
    expect(fixture.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "startDamageStep", responsePlayer: 0 } });

    const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "startDamageStep", responsePlayer: 0 } });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const quick = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect");
    expect(quick).toMatchObject({ player: 0, windowKind: "battle" });

    const result = applyLuaRestoreResponse(restored, quick!);
    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", damagePasses: [], battleWindow: { kind: "startDamageStep", responsePlayer: 0 } });
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passChain", player: 1, windowKind: "chainResponse" })]));
    expect(getDuelLegalActions(restored.session, 0)).toEqual([]);

    const staleQuick = applyLuaRestoreResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleQuick.legalActions);

    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(resolved.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleWindow: { kind: "startDamageStep", responsePlayer: 1 } });
    expect(resolved.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);
    expect(resolved.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(restored.host.messages).toEqual(["restored battle quick resolved"]);
  });

  it("resets restored damage-calculation passes after a Lua quick effect resolves", () => {
    const fixture = setupRestoredBattleQuick("EFFECT_FLAG_DAMAGE_CAL");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    expect(fixture.session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    passBattleResponse(fixture.session, 1, "passDamage");
    expect(fixture.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleStep: "damageCalculation", battleWindow: { kind: "duringDamageCalculation", responsePlayer: 0 } });

    const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleStep: "damageCalculation", battleWindow: { kind: "duringDamageCalculation", responsePlayer: 0 } });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const quick = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect");
    expect(quick).toMatchObject({ player: 0, windowKind: "battle" });

    const result = applyLuaRestoreResponse(restored, quick!);
    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", damagePasses: [], battleWindow: { kind: "duringDamageCalculation", responsePlayer: 0 } });
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passChain", player: 1, windowKind: "chainResponse" })]));
    expect(getDuelLegalActions(restored.session, 0)).toEqual([]);

    const staleQuick = applyLuaRestoreResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleQuick.legalActions);

    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(resolved.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleStep: "damageCalculation", battleWindow: { kind: "duringDamageCalculation", responsePlayer: 1 } });
    expect(resolved.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);
    expect(resolved.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(restored.host.messages).toEqual(["restored battle quick resolved"]);
  });

  it("resets restored after-damage-calculation passes after a Lua quick effect resolves", () => {
    const fixture = setupRestoredBattleQuick("EFFECT_FLAG_DAMAGE_STEP");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    expect(fixture.session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    passBattleResponse(fixture.session, 1, "passDamage");
    expect(fixture.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "afterDamageCalculation", responsePlayer: 0 } });

    const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "afterDamageCalculation", responsePlayer: 0 } });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const quick = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect");
    expect(quick).toMatchObject({ player: 0, windowKind: "battle" });

    const result = applyLuaRestoreResponse(restored, quick!);
    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", damagePasses: [], battleWindow: { kind: "afterDamageCalculation", responsePlayer: 0 } });
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passChain", player: 1, windowKind: "chainResponse" })]));
    expect(getDuelLegalActions(restored.session, 0)).toEqual([]);

    const staleQuick = applyLuaRestoreResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleQuick.legalActions);

    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(resolved.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleWindow: { kind: "afterDamageCalculation", responsePlayer: 1 } });
    expect(resolved.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);
    expect(resolved.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(restored.host.messages).toEqual(["restored battle quick resolved"]);
  });

  it("resets restored end-damage-step passes after a Lua quick effect resolves", () => {
    const fixture = setupRestoredBattleQuick("EFFECT_FLAG_DAMAGE_STEP");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    expect(fixture.session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    expect(fixture.session.state.battleWindow?.kind).toBe("endDamageStep");
    passBattleResponse(fixture.session, 1, "passDamage");
    expect(fixture.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "endDamageStep", responsePlayer: 0 } });

    const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "endDamageStep", responsePlayer: 0 } });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const quick = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect");
    expect(quick).toMatchObject({ player: 0, windowKind: "battle" });

    const result = applyLuaRestoreResponse(restored, quick!);
    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", damagePasses: [], battleWindow: { kind: "endDamageStep", responsePlayer: 0 } });
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passChain", player: 1, windowKind: "chainResponse" })]));
    expect(getDuelLegalActions(restored.session, 0)).toEqual([]);

    const staleQuick = applyLuaRestoreResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleQuick.legalActions);

    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(resolved.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleWindow: { kind: "endDamageStep", responsePlayer: 1 } });
    expect(resolved.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);
    expect(resolved.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(restored.host.messages).toEqual(["restored battle quick resolved"]);
  });

  it("cleans up restored end-damage-step windows after both players pass", () => {
    const fixture = setupRestoredBattleQuick("EFFECT_FLAG_DAMAGE_STEP");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    expect(fixture.session.state.battleWindow?.kind).toBe("endDamageStep");
    passBattleResponse(fixture.session, 1, "passDamage");
    expect(fixture.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "endDamageStep", responsePlayer: 0 } });

    const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "endDamageStep", responsePlayer: 0 } });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const pass = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "passDamage");
    expect(pass).toMatchObject({ player: 0, windowKind: "battle" });

    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 0, windowKind: "open", damagePasses: [], players: { 1: { lifePoints: 6200 } } });
    expect(result.state.battleWindow).toBeUndefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(getDuelLegalActions(restored.session, 1)).toEqual([]);
    expect(restored.session.state.players[1].lifePoints).toBe(6200);
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.battleWindow).toBeUndefined();
    expect(restored.host.messages).toEqual([]);
  });

  it("queues Lua battle-damage triggers after restored end-damage-step cleanup", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Cleanup Trigger Attacker", kind: "monster", attack: 1800 },
      { code: "500", name: "Restore Cleanup Battle Damage Trigger", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c500.lua") return undefined;
        return `
        c500={}
        function c500.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_BATTLE_DAMAGE)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg,ep,ev,re,r)
            Debug.Message("restored cleanup battle damage " .. ep .. "/" .. ev .. "/" .. r .. "/" .. Duel.GetLP(1))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 58, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "500"] }, 1: { main: [] } });
    startDuel(session);
    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(500, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    expect(applyResponse(session, battle!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined);
    expect(attack).toBeDefined();
    expect(applyResponse(session, attack!).ok).toBe(true);
    passBattleResponse(session, 1, "passAttack");
    passBattleResponse(session, 0, "passAttack");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    expect(session.state.battleWindow?.kind).toBe("endDamageStep");
    passBattleResponse(session, 1, "passDamage");
    expect(session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "endDamageStep", responsePlayer: 0 } });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const pass = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "passDamage");
    expect(pass).toMatchObject({ player: 0, windowKind: "battle" });
    const cleaned = applyLuaRestoreResponse(restored, pass!);
    expect(cleaned.ok, cleaned.error).toBe(true);
    expect(cleaned.state).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket", players: { 1: { lifePoints: 6200 } } });
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleDamageDealt"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1143, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 });
    expect(restored.session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "battleDamageDealt", eventCode: 1143, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 })]));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const stalePass = applyLuaRestoreResponse(restored, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(stalePass.legalActionGroups.flatMap((group) => group.actions)).toEqual(stalePass.legalActions);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toMatchObject({ player: 0, windowKind: "triggerBucket" });
    const triggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(triggerResult.ok, triggerResult.error).toBe(true);
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggerResult.legalActions);
    expect(restored.host.messages).toEqual(["restored cleanup battle damage 1/1800/32/6200"]);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.battleWindow).toBeUndefined();
    expect(triggerResult.state).toMatchObject({ waitingFor: 0, windowKind: "open", players: { 1: { lifePoints: 6200 } } });
    const staleTrigger = applyLuaRestoreResponse(restored, trigger!);
    expect(staleTrigger.ok).toBe(false);
    expect(staleTrigger.error).toContain("Response is not currently legal");
    expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, staleTrigger.state.waitingFor!));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, staleTrigger.state.waitingFor!));
    expect(staleTrigger.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleTrigger.legalActions);
  });
});

function setupRestoredBattleQuick(property: "EFFECT_FLAG_DAMAGE_STEP" | "EFFECT_FLAG_DAMAGE_CAL") {
  const cards: DuelCardData[] = [
    { code: "100", name: "Restore Battle Priority Attacker", kind: "monster", attack: 1800 },
    { code: "300", name: "Restore Battle Priority Quick", kind: "monster" },
    { code: "400", name: "Restore Battle Chain Quick", kind: "monster" },
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
      return undefined;
    },
  };
  const session = createDuel({ seed: property === "EFFECT_FLAG_DAMAGE_STEP" ? 56 : 57, startingHandSize: 2, cardReader: createCardReader(cards) });
  loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: ["400"] } });
  startDuel(session);

  const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
  expect(attacker).toBeDefined();
  moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

  const host = createLuaScriptHost(session);
  expect(host.loadCardScript(300, source).ok).toBe(true);
  expect(host.loadCardScript(400, source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);

  const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
  expect(battle).toBeDefined();
  expect(applyResponse(session, battle!).ok).toBe(true);
  const attack = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined);
  expect(attack).toBeDefined();
  expect(applyResponse(session, attack!).ok).toBe(true);
  passBattleResponse(session, 1, "passAttack");
  passBattleResponse(session, 0, "passAttack");
  expect(session.state.battleWindow?.kind).toBe("startDamageStep");
  return { cards, session, source };
}

function activateTurnQuick(fixture: ReturnType<typeof setupRestoredBattleQuick>): void {
  const quick = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "activateEffect");
  expect(quick).toBeDefined();
  const result = applyResponse(fixture.session, quick!);
  expect(result.ok, result.error).toBe(true);
  expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
}

function passBattleResponse(session: ReturnType<typeof createDuel>, player: 0 | 1, type: "passAttack" | "passDamage"): void {
  const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === type);
  expect(pass).toBeDefined();
  const result = applyResponse(session, pass!);
  expect(result.ok, result.error).toBe(true);
}
