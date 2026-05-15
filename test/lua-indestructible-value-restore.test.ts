import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua indestructible value restore", () => {
  it("restores aux.indsval as own-player destruction protection", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Self Protection Source", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "200", name: "Self Protected Target", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 341, startingHandSize: 2, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "100");
    const protectedCard = session.state.cards.find((card) => card.code === "200");
    expect(source).toBeDefined();
    expect(protectedCard).toBeDefined();
    moveDuelCard(session.state, source!.uid, "graveyard", 0);
    moveDuelCard(session.state, protectedCard!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_FIELD)
      e:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)
      e:SetTargetRange(LOCATION_MZONE,0)
      e:SetValue(aux.indsval)
      e:SetReset(RESET_PHASE|PHASE_END)
      Duel.RegisterEffect(e,0)
      `,
      "restore-indsval.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 41,
          controller: 0,
          sourceUid: source!.uid,
          luaValueDescriptor: "indestructible:self",
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: () => undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 41,
          controller: 0,
          sourceUid: source!.uid,
          luaValueDescriptor: "indestructible:self",
        }),
      ]),
    );

    const ownDestroy = destroyDuelCard(restored.session.state, protectedCard!.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(ownDestroy).toMatchObject({ uid: protectedCard!.uid, location: "monsterZone" });
    const opponentDestroy = destroyDuelCard(restored.session.state, protectedCard!.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(opponentDestroy).toMatchObject({ uid: protectedCard!.uid, location: "graveyard" });
  });

  it("restores temporary counted indestructible reason-mask predicates", () => {
    const cards: DuelCardData[] = [
      { code: "300", name: "Temporary Protection Source", kind: "spell", typeFlags: 0x2 },
      { code: "400", name: "Temporary Protected Target", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 342, startingHandSize: 2, cardReader: reader });
    loadDecks(session, { 0: { main: ["300", "400"] }, 1: { main: [] } });
    startDuel(session);

    const target = session.state.cards.find((card) => card.code === "400");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local tc=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(tc)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_INDESTRUCTABLE_COUNT)
      e:SetCountLimit(1)
      e:SetValue(function(_,_,r) return (r&REASON_BATTLE+REASON_EFFECT)~=0 end)
      e:SetReset(RESETS_STANDARD_PHASE_END)
      tc:RegisterEffect(e)
      `,
      "temporary-counted-indestructible.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 47,
          sourceUid: target!.uid,
          luaValueDescriptor: "value-predicate:reason-mask:96",
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: () => undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 47,
          sourceUid: target!.uid,
          luaValueDescriptor: "value-predicate:reason-mask:96",
        }),
      ]),
    );

    const battleDestroy = destroyDuelCard(restored.session.state, target!.uid, 0, duelReason.battle | duelReason.destroy, 1);
    expect(battleDestroy).toMatchObject({ uid: target!.uid, location: "monsterZone" });
    const effectDestroy = destroyDuelCard(restored.session.state, target!.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(effectDestroy).toMatchObject({ uid: target!.uid, location: "graveyard" });
  });

  it("restores equality-form reason-mask predicates", () => {
    const cards: DuelCardData[] = [
      { code: "500", name: "Battle Predicate Target A", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "501", name: "Battle Predicate Target B", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 343, startingHandSize: 2, cardReader: reader });
    loadDecks(session, { 0: { main: ["500", "501"] }, 1: { main: [] } });
    startDuel(session);

    const battleTarget = session.state.cards.find((card) => card.code === "500");
    const effectTarget = session.state.cards.find((card) => card.code === "501");
    expect(battleTarget).toBeDefined();
    expect(effectTarget).toBeDefined();
    moveDuelCard(session.state, battleTarget!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, effectTarget!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local function protect(code)
        local tc=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
        local e=Effect.CreateEffect(tc)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_INDESTRUCTABLE_COUNT)
        e:SetCountLimit(1)
        e:SetValue(function(_,_,r) return r&REASON_BATTLE==REASON_BATTLE end)
        e:SetReset(RESETS_STANDARD_PHASE_END)
        tc:RegisterEffect(e)
      end
      protect(500)
      protect(501)
      `,
      "temporary-counted-battle-indestructible.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 47,
          sourceUid: battleTarget!.uid,
          luaValueDescriptor: "value-predicate:reason-mask:32",
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: () => undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const battleDestroy = destroyDuelCard(restored.session.state, battleTarget!.uid, 0, duelReason.battle | duelReason.destroy, 1);
    expect(battleDestroy).toMatchObject({ uid: battleTarget!.uid, location: "monsterZone" });
    const effectDestroy = destroyDuelCard(restored.session.state, effectTarget!.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(effectDestroy).toMatchObject({ uid: effectTarget!.uid, location: "graveyard" });
  });
});
