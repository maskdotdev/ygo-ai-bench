import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dimension Fortress Weapon deck grave lock", () => {
  it("restores official EFFECT_CANNOT_TO_GRAVE and blocks Deck-to-GY movement for both players", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fortressCode = "1596508";
    const selfDeckCode = "900000267";
    const opponentDeckCode = "900000268";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === fortressCode),
      { code: selfDeckCode, name: "Dimension Fortress Self Mill Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: opponentDeckCode, name: "Dimension Fortress Opponent Mill Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 159, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fortressCode, selfDeckCode] }, 1: { main: [opponentDeckCode] } });
    startDuel(session);

    const fortress = session.state.cards.find((card) => card.code === fortressCode);
    expect(fortress).toBeDefined();
    moveDuelCard(session.state, fortress!.uid, "monsterZone", 0);
    fortress!.position = "faceUpAttack";
    fortress!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fortressCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 68,
          sourceUid: fortress!.uid,
          targetRange: [1, 1],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const probe = restored.host.loadScript(
      `
      local self_card=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${selfDeckCode}),0,LOCATION_DECK,0,1,1,nil):GetFirst()
      local opponent_card=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${opponentDeckCode}),0,0,LOCATION_DECK,1,1,nil):GetFirst()
      Debug.Message("fortress self able grave " .. tostring(self_card:IsAbleToGrave()))
      Debug.Message("fortress opp able grave " .. tostring(opponent_card:IsAbleToGrave()))
      Debug.Message("fortress self grave result " .. Duel.SendtoGrave(self_card,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("fortress opp grave result " .. Duel.SendtoGrave(opponent_card,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
      `,
      "dimension-fortress-deck-grave-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "fortress self able grave false",
        "fortress opp able grave false",
        "fortress self grave result 0/0",
        "fortress opp grave result 0/0",
      ]),
    );
    expect(restored.session.state.cards.find((card) => card.code === selfDeckCode)).toMatchObject({ location: "deck" });
    expect(restored.session.state.cards.find((card) => card.code === opponentDeckCode)).toMatchObject({ location: "deck" });
  });
});
