import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
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
    player: source.controller,
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous controller reason player reason condition", () => {
  it("restores comma-local GetReasonPlayer opponent reason previous-controller checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mikorangeCode = "47077318";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mikorangeCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4710, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mikorangeCode] }, 1: { main: [] } });
    startDuel(session);

    const mikorange = session.state.cards.find((card) => card.code === mikorangeCode);
    expect(mikorange).toBeDefined();
    moveDuelCard(session.state, mikorange!.uid, "monsterZone", 0);
    moveDuelCard(session.state, mikorange!.uid, "graveyard", 0, duelReason.destroy, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${mikorangeCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e,tp)
        local c,p=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsReason(REASON_DESTROY) and c:GetReasonPlayer()~=tp and c:IsPreviousControler(tp)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "mikorange-comma-local-previous-controller-reason-player-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-controller-reason-player-reason:${duelReason.destroy}:opponent`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ luaConditionDescriptor: descriptor, sourceUid: mikorange!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredMikorange = restored.session.state.cards.find((card) => card.code === mikorangeCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === mikorange!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredMikorange!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredMikorange!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReasonPlayer: 1 })).toBe(true);
    restoredMikorange!.reasonPlayer = 1;
    restoredMikorange!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredMikorange!.previousController = 0;
    restoredMikorange!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReason: duelReason.destroy })).toBe(true);
  });

  it("restores destroyed-by-opponent previous-controller checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const messengelatoCode = "52404456";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === messengelatoCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5240, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [messengelatoCode] }, 1: { main: [] } });
    startDuel(session);

    const messengelato = session.state.cards.find((card) => card.code === messengelatoCode);
    expect(messengelato).toBeDefined();
    moveDuelCard(session.state, messengelato!.uid, "monsterZone", 0);
    moveDuelCard(session.state, messengelato!.uid, "graveyard", 0, duelReason.destroy, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(messengelatoCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-controller-reason-player-reason:${duelReason.destroy}:opponent`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: messengelato!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredMessengelato = restored.session.state.cards.find((card) => card.code === messengelatoCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === messengelato!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredMessengelato!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredMessengelato!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredMessengelato!.reasonPlayer = 1;
    restoredMessengelato!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredMessengelato!.previousController = 0;
    restoredMessengelato!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores opponent event-reason previous-controller checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const novaCode = "58069384";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === novaCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5806, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [novaCode] }, 1: { main: [] } });
    startDuel(session);

    const nova = session.state.cards.find((card) => card.code === novaCode);
    expect(nova).toBeDefined();
    moveDuelCard(session.state, nova!.uid, "monsterZone", 0);
    moveDuelCard(session.state, nova!.uid, "graveyard", 0, duelReason.effect, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(novaCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-controller-reason-player-reason:${duelReason.effect}:opponent`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: nova!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredNova = restored.session.state.cards.find((card) => card.code === novaCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === nova!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredNova!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredNova!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredNova!.reasonPlayer = 1;
    restoredNova!.reason = duelReason.destroy;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReason: duelReason.effect })).toBe(true);
  });

  it("restores local-handler opponent reason previous-controller checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const nightCode = "85827713";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === nightCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8582, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [nightCode] }, 1: { main: [] } });
    startDuel(session);

    const night = session.state.cards.find((card) => card.code === nightCode);
    expect(night).toBeDefined();
    moveDuelCard(session.state, night!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, night!.uid, "graveyard", 0, duelReason.destroy, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(nightCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-controller-reason-player-reason:${duelReason.destroy}:opponent`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: night!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredNight = restored.session.state.cards.find((card) => card.code === nightCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === night!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredNight!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredNight!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredNight!.reasonPlayer = 1;
    restoredNight!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local-handler reason-first opponent previous-controller checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const magicianCode = "24731391";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === magicianCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2473, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [magicianCode] }, 1: { main: [] } });
    startDuel(session);

    const magician = session.state.cards.find((card) => card.code === magicianCode);
    expect(magician).toBeDefined();
    moveDuelCard(session.state, magician!.uid, "monsterZone", 0);
    moveDuelCard(session.state, magician!.uid, "graveyard", 0, duelReason.effect, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(magicianCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-controller-reason-player-reason:${duelReason.effect}:opponent`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ luaConditionDescriptor: descriptor, sourceUid: magician!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredMagician = restored.session.state.cards.find((card) => card.code === magicianCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === magician!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredMagician!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredMagician!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local-handler previous-controller-first opponent reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const falconCode = "15092394";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === falconCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1509, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [falconCode] }, 1: { main: [] } });
    startDuel(session);

    const falcon = session.state.cards.find((card) => card.code === falconCode);
    expect(falcon).toBeDefined();
    moveDuelCard(session.state, falcon!.uid, "monsterZone", 0);
    moveDuelCard(session.state, falcon!.uid, "graveyard", 0, duelReason.destroy, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(falconCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-controller-reason-player-reason:${duelReason.destroy}:opponent`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ luaConditionDescriptor: descriptor, sourceUid: falcon!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredFalcon = restored.session.state.cards.find((card) => card.code === falconCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === falcon!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredFalcon!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredFalcon!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local-handler GetReasonPlayer opponent reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mikorangeCode = "47077318";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mikorangeCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4707, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mikorangeCode] }, 1: { main: [] } });
    startDuel(session);

    const mikorange = session.state.cards.find((card) => card.code === mikorangeCode);
    expect(mikorange).toBeDefined();
    moveDuelCard(session.state, mikorange!.uid, "monsterZone", 0);
    moveDuelCard(session.state, mikorange!.uid, "graveyard", 0, duelReason.destroy, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(mikorangeCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-controller-reason-player-reason:${duelReason.destroy}:opponent`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ luaConditionDescriptor: descriptor, sourceUid: mikorange!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredMikorange = restored.session.state.cards.find((card) => card.code === mikorangeCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === mikorange!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredMikorange!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredMikorange!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredMikorange!.reasonPlayer = 1;
    restoredMikorange!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local-handler GetPreviousControler opponent reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const logesFlameCode = "18478530";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === logesFlameCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1847, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [logesFlameCode] }, 1: { main: [] } });
    startDuel(session);

    const logesFlame = session.state.cards.find((card) => card.code === logesFlameCode);
    expect(logesFlame).toBeDefined();
    moveDuelCard(session.state, logesFlame!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, logesFlame!.uid, "graveyard", 0, duelReason.effect, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(logesFlameCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-controller-reason-player-reason:${duelReason.effect}:opponent`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ luaConditionDescriptor: descriptor, sourceUid: logesFlame!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredLogesFlame = restored.session.state.cards.find((card) => card.code === logesFlameCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === logesFlame!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredLogesFlame!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredLogesFlame!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredLogesFlame!.previousController = 0;
    restoredLogesFlame!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
