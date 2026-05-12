import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: 0,
    targetUids: [],
    log: () => {},
    moveCard: () => source,
    negateChainLink: () => false,
    setTargets: () => {},
    getTargets: () => [],
    setTargetPlayer: () => {},
    setTargetParam: () => {},
  };
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Checksum Dragon position indestructible", () => {
  it("restores local-handler Attack Position and Defense Position predicates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const checksumDragonCode = "94136469";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === checksumDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 942, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [checksumDragonCode] }, 1: { main: [] } });
    startDuel(session);

    const checksumDragon = session.state.cards.find((card) => card.code === checksumDragonCode);
    expect(checksumDragon).toBeDefined();
    moveDuelCard(session.state, checksumDragon!.uid, "monsterZone", 0);
    checksumDragon!.faceUp = true;
    checksumDragon!.position = "faceUpAttack";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${checksumDragonCode}),0,LOCATION_MZONE,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e1:SetRange(LOCATION_MZONE)
      e1:SetCondition(function(e)
        local c=e:GetHandler()
        return c:IsAttackPos()
      end)
      e1:SetValue(aux.tgoval)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e2:SetRange(LOCATION_MZONE)
      e2:SetCondition(function(e)
        local c=e:GetHandler()
        return c:IsDefensePos()
      end)
      e2:SetValue(aux.tgoval)
      c:RegisterEffect(e2)
      `,
      "checksum-dragon-official-local-position-indestructible.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 71, luaConditionDescriptor: "condition:source-attack-position" }),
        expect.objectContaining({ event: "continuous", code: 71, luaConditionDescriptor: "condition:source-defense-position" }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredDragon = restored.session.state.cards.find((card) => card.code === checksumDragonCode);
    const attackEffect = restored.session.state.effects.find((effect) => effect.sourceUid === checksumDragon!.uid && effect.code === 71 && effect.luaConditionDescriptor === "condition:source-attack-position");
    const defenseEffect = restored.session.state.effects.find((effect) => effect.sourceUid === checksumDragon!.uid && effect.code === 71 && effect.luaConditionDescriptor === "condition:source-defense-position");
    expect(attackEffect?.canActivate).toBeDefined();
    expect(defenseEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredDragon!);
    expect(attackEffect!.canActivate!(ctx)).toBe(true);
    expect(defenseEffect!.canActivate!(ctx)).toBe(false);
    restoredDragon!.position = "faceUpDefense";
    expect(attackEffect!.canActivate!(ctx)).toBe(false);
    expect(defenseEffect!.canActivate!(ctx)).toBe(true);
    restoredDragon!.position = "faceDownDefense";
    expect(defenseEffect!.canActivate!(ctx)).toBe(true);
  });

  it("restores its Attack Position-only battle indestructible effect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const checksumDragonCode = "94136469";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === checksumDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 941, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [checksumDragonCode] }, 1: { main: [] } });
    startDuel(session);

    const checksumDragon = session.state.cards.find((card) => card.code === checksumDragonCode);
    expect(checksumDragon).toBeDefined();
    moveDuelCard(session.state, checksumDragon!.uid, "monsterZone", 0);
    checksumDragon!.faceUp = true;
    checksumDragon!.position = "faceUpAttack";

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(checksumDragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 42,
          sourceUid: checksumDragon!.uid,
          luaConditionDescriptor: "condition:source-attack-position",
          range: ["monsterZone"],
          value: 1,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredDragon = restored.session.state.cards.find((card) => card.code === checksumDragonCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === checksumDragon!.uid && effect.code === 42);
    expect(restoredDragon).toBeDefined();
    expect(restoredEffect).toMatchObject({
      event: "continuous",
      code: 42,
      luaConditionDescriptor: "condition:source-attack-position",
      range: ["monsterZone"],
      value: 1,
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredDragon!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);

    const attackPositionDestroy = destroyDuelCard(restored.session.state, restoredDragon!.uid, 0, duelReason.battle | duelReason.destroy, 1);
    expect(attackPositionDestroy).toMatchObject({ uid: restoredDragon!.uid, location: "monsterZone" });

    restoredDragon!.position = "faceUpDefense";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    const defensePositionDestroy = destroyDuelCard(restored.session.state, restoredDragon!.uid, 0, duelReason.battle | duelReason.destroy, 1);
    expect(defensePositionDestroy).toMatchObject({ uid: restoredDragon!.uid, location: "graveyard", reason: duelReason.battle | duelReason.destroy });
  });
});
