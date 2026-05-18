import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Bazoo banish-count ATK boost", () => {
  it("restores selected banish cost count into the temporary ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const bazooCode = "40133511";
    const costCodes = ["40133512", "40133513", "40133514"];
    const script = workspace.readScript(`c${bazooCode}.lua`);
    expect(script).toContain("local cg=Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,3,e:GetHandler())");
    expect(script).toContain("Duel.Remove(cg,POS_FACEUP,REASON_COST)");
    expect(script).toContain("e:SetLabel(#cg)");
    expect(script).toContain("e1:SetValue(count*300)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === bazooCode),
      ...costCodes.map((code, index) => ({
        code,
        name: `Bazoo Banish Cost ${index + 1}`,
        kind: "monster" as const,
        typeFlags: typeMonster,
        level: 4,
        attack: 1000,
        defense: 1000,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4013, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bazooCode, ...costCodes] }, 1: { main: [] } });
    startDuel(session);

    const bazoo = session.state.cards.find((card) => card.code === bazooCode);
    const costs = costCodes.map((code) => session.state.cards.find((card) => card.code === code));
    expect(bazoo).toBeDefined();
    expect(costs.every(Boolean)).toBe(true);
    moveDuelCard(session.state, bazoo!.uid, "monsterZone", 0);
    for (const cost of costs) moveDuelCard(session.state, cost!.uid, "graveyard", 0);
    bazoo!.faceUp = true;
    bazoo!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bazooCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === bazoo!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, activation!);
    expect(activated.ok, activated.error).toBe(true);
    for (const cost of costs) {
      expect(restored.session.state.cards.find((card) => card.uid === cost!.uid)).toMatchObject({
        location: "banished",
        previousLocation: "graveyard",
        reason: duelReason.cost,
      });
    }
    expect(
      restored.session.state.eventHistory.filter(
        (event) =>
          event.eventName === "banished" &&
          event.eventUids === undefined &&
          costCodes.some((code) => (event.eventCardUid ?? "").includes(code)),
      ),
    ).toHaveLength(3);
    expect(restored.session.state.chain).toHaveLength(0);
    const boostedBazoo = restored.session.state.cards.find((card) => card.uid === bazoo!.uid);
    expect(currentAttack(boostedBazoo, restored.session.state)).toBe((bazoo!.data.attack ?? 0) + 900);
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === bazoo!.uid && effect.code === 100)).toMatchObject({
      code: 100,
      event: "continuous",
      sourceUid: bazoo!.uid,
      value: 900,
    });

    const restoredBoosted = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expect(restoredBoosted.restoreComplete, restoredBoosted.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBoosted.missingRegistryKeys).toEqual([]);
    expect(restoredBoosted.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredBoosted, 0)).toEqual(getGroupedDuelLegalActions(restoredBoosted.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredBoosted, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredBoosted, 0));
    expect(currentAttack(restoredBoosted.session.state.cards.find((card) => card.uid === bazoo!.uid), restoredBoosted.session.state)).toBe(
      (bazoo!.data.attack ?? 0) + 900,
    );
  });
});
