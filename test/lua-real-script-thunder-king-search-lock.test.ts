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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Thunder King Rai-Oh search lock", () => {
  it("restores official EFFECT_CANNOT_TO_HAND and blocks Deck-to-hand movement for both players", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const thunderKingCode = "71564252";
    const selfDeckCode = "900000263";
    const opponentDeckCode = "900000264";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === thunderKingCode),
      { code: selfDeckCode, name: "Thunder King Self Search Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: opponentDeckCode, name: "Thunder King Opponent Search Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 715, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [thunderKingCode, selfDeckCode] }, 1: { main: [opponentDeckCode] } });
    startDuel(session);

    const thunderKing = session.state.cards.find((card) => card.code === thunderKingCode);
    expect(thunderKing).toBeDefined();
    moveDuelCard(session.state, thunderKing!.uid, "monsterZone", 0);
    thunderKing!.position = "faceUpAttack";
    thunderKing!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(thunderKingCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 65,
          sourceUid: thunderKing!.uid,
          targetRange: [1, 1],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const probe = restored.host.loadScript(
      `
      local self_card=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${selfDeckCode}),0,LOCATION_DECK,0,1,1,nil):GetFirst()
      local opponent_card=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${opponentDeckCode}),0,0,LOCATION_DECK,1,1,nil):GetFirst()
      Debug.Message("thunder self able hand " .. tostring(self_card:IsAbleToHand()))
      Debug.Message("thunder opp able hand " .. tostring(opponent_card:IsAbleToHand()))
      Debug.Message("thunder self hand result " .. Duel.SendtoHand(self_card,nil,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("thunder opp hand result " .. Duel.SendtoHand(opponent_card,nil,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
      `,
      "thunder-king-search-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "thunder self able hand false",
        "thunder opp able hand false",
        "thunder self hand result 0/0",
        "thunder opp hand result 0/0",
      ]),
    );
    expect(restored.session.state.cards.find((card) => card.code === selfDeckCode)).toMatchObject({ location: "deck" });
    expect(restored.session.state.cards.find((card) => card.code === opponentDeckCode)).toMatchObject({ location: "deck" });
  });
});
