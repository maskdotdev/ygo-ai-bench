import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Runick Slumber indestructible count restore", () => {
  it("restores Runick Slumber's temporary battle/effect destruction count", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const slumberCode = "67835547";
    const targetCode = "67835548";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === slumberCode),
      { code: targetCode, name: "Runick Slumber Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 679, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [slumberCode, targetCode] }, 1: { main: [] } });
    startDuel(session);

    const slumber = session.state.cards.find((card) => card.code === slumberCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(slumber).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, slumber!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(slumberCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === slumber!.uid);
    expect(action, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, action!);
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

    const restoredProtection = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredProtection.restoreComplete, restoredProtection.incompleteReasons.join("; ")).toBe(true);
    const battleDestroy = destroyDuelCard(restoredProtection.session.state, target!.uid, 0, duelReason.battle | duelReason.destroy, 1);
    expect(battleDestroy).toMatchObject({ uid: target!.uid, location: "monsterZone" });
    const effectDestroy = destroyDuelCard(restoredProtection.session.state, target!.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(effectDestroy).toMatchObject({ uid: target!.uid, location: "graveyard" });
  });
});

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  if (response.state.waitingFor !== undefined) expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor));
}
