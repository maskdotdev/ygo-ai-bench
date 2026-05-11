import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script battle target predicates", () => {
  it("restores battle-target type predicates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const devourerCode = "98336111";
    const fusionCode = "8198620";
    const nonFusionCode = "56921677";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [devourerCode, fusionCode, nonFusionCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8222, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [devourerCode, nonFusionCode], extra: [fusionCode] }, 1: { main: [] } });
    startDuel(session);

    const devourer = session.state.cards.find((card) => card.code === devourerCode);
    const fusion = session.state.cards.find((card) => card.code === fusionCode);
    const nonFusion = session.state.cards.find((card) => card.code === nonFusionCode);
    expect(devourer).toBeDefined();
    expect(fusion).toBeDefined();
    expect(nonFusion).toBeDefined();
    moveDuelCard(session.state, devourer!.uid, "monsterZone", 0);
    moveDuelCard(session.state, fusion!.uid, "monsterZone", 1);
    moveDuelCard(session.state, nonFusion!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(devourerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 102, luaTargetDescriptor: "target:source-battle-target-type:64", sourceUid: devourer!.uid }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredDevourer = restored.session.state.cards.find((card) => card.code === devourerCode);
    const restoredFusion = restored.session.state.cards.find((card) => card.code === fusionCode);
    const restoredNonFusion = restored.session.state.cards.find((card) => card.code === nonFusionCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === devourer!.uid && candidate.luaTargetDescriptor === "target:source-battle-target-type:64");
    expect(effect?.targetCardPredicate).toBeDefined();
    restored.session.state.currentAttack = { attackerUid: restoredDevourer!.uid, targetUid: restoredFusion!.uid };
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredFusion!)).toBe(true);
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredDevourer!)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredDevourer!.uid, targetUid: restoredNonFusion!.uid };
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredNonFusion!)).toBe(false);
  });

  it("restores handler and battle-target field predicates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const reflectionCode = "63947968";
    const dragonecroCode = "8198620";
    const targetCode = "72329844";
    const idleCode = "56921677";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [reflectionCode, dragonecroCode, targetCode, idleCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8221, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [reflectionCode, targetCode, idleCode], extra: [dragonecroCode] }, 1: { main: [] } });
    startDuel(session);

    const reflection = session.state.cards.find((card) => card.code === reflectionCode);
    const dragonecro = session.state.cards.find((card) => card.code === dragonecroCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const idle = session.state.cards.find((card) => card.code === idleCode);
    expect(reflection).toBeDefined();
    expect(dragonecro).toBeDefined();
    expect(target).toBeDefined();
    expect(idle).toBeDefined();
    moveDuelCard(session.state, reflection!.uid, "monsterZone", 0);
    moveDuelCard(session.state, dragonecro!.uid, "monsterZone", 1);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);
    moveDuelCard(session.state, idle!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(reflectionCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(dragonecroCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 42, luaTargetDescriptor: "target:source-or-battle-target", sourceUid: reflection!.uid }),
        expect.objectContaining({ code: 42, luaTargetDescriptor: "target:source-battle-target", sourceUid: dragonecro!.uid }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredReflection = restored.session.state.cards.find((card) => card.code === reflectionCode);
    const restoredDragonecro = restored.session.state.cards.find((card) => card.code === dragonecroCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const restoredIdle = restored.session.state.cards.find((card) => card.code === idleCode);
    const sourceOrBattleTarget = restored.session.state.effects.find((effect) => effect.sourceUid === reflection!.uid && effect.luaTargetDescriptor === "target:source-or-battle-target");
    const battleTargetOnly = restored.session.state.effects.find((effect) => effect.sourceUid === dragonecro!.uid && effect.luaTargetDescriptor === "target:source-battle-target");
    expect(sourceOrBattleTarget?.targetCardPredicate).toBeDefined();
    expect(battleTargetOnly?.targetCardPredicate).toBeDefined();

    restored.session.state.currentAttack = { attackerUid: restoredReflection!.uid, targetUid: restoredTarget!.uid };
    expect(sourceOrBattleTarget!.targetCardPredicate!({ duel: restored.session.state } as never, restoredReflection!)).toBe(true);
    expect(sourceOrBattleTarget!.targetCardPredicate!({ duel: restored.session.state } as never, restoredTarget!)).toBe(true);
    expect(sourceOrBattleTarget!.targetCardPredicate!({ duel: restored.session.state } as never, restoredIdle!)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredDragonecro!.uid, targetUid: restoredTarget!.uid };
    expect(battleTargetOnly!.targetCardPredicate!({ duel: restored.session.state } as never, restoredTarget!)).toBe(true);
    expect(battleTargetOnly!.targetCardPredicate!({ duel: restored.session.state } as never, restoredDragonecro!)).toBe(false);
    expect(battleTargetOnly!.targetCardPredicate!({ duel: restored.session.state } as never, restoredIdle!)).toBe(false);
    delete restored.session.state.currentAttack;
    expect(sourceOrBattleTarget!.targetCardPredicate!({ duel: restored.session.state } as never, restoredReflection!)).toBe(true);
    expect(battleTargetOnly!.targetCardPredicate!({ duel: restored.session.state } as never, restoredTarget!)).toBe(false);
  });
});
