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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Vanity's Fiend special summon lock", () => {
  it("restores official EFFECT_CANNOT_SPECIAL_SUMMON and blocks summon predicates and operations", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const vanityCode = "47084486";
    const selfSummonCode = "900000276";
    const opponentSummonCode = "900000277";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === vanityCode),
      { code: selfSummonCode, name: "Vanity Self Summon Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: opponentSummonCode, name: "Vanity Opponent Summon Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 470, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [vanityCode, selfSummonCode] }, 1: { main: [opponentSummonCode] } });
    startDuel(session);

    const vanity = session.state.cards.find((card) => card.code === vanityCode);
    const selfSummon = session.state.cards.find((card) => card.code === selfSummonCode);
    const opponentSummon = session.state.cards.find((card) => card.code === opponentSummonCode);
    expect(vanity).toBeDefined();
    expect(selfSummon).toBeDefined();
    expect(opponentSummon).toBeDefined();
    moveDuelCard(session.state, vanity!.uid, "monsterZone", 0);
    vanity!.position = "faceUpAttack";
    vanity!.faceUp = true;
    moveDuelCard(session.state, selfSummon!.uid, "hand", 0);
    moveDuelCard(session.state, opponentSummon!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(vanityCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 22,
          sourceUid: vanity!.uid,
          targetRange: [1, 1],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const probe = restored.host.loadScript(
      `
      local self_card=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${selfSummonCode}),0,LOCATION_HAND,0,nil)
      local opponent_card=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${opponentSummonCode}),0,0,LOCATION_HAND,nil)
      Debug.Message("vanity can special " .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,self_card)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(1,0,POS_FACEUP_ATTACK,1,opponent_card)))
      Debug.Message("vanity special result " .. Duel.SpecialSummon(self_card,0,0,0,false,false,POS_FACEUP_ATTACK) .. "/" .. Duel.SpecialSummon(opponent_card,0,1,1,false,false,POS_FACEUP_ATTACK))
      `,
      "vanitys-fiend-special-summon-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("vanity can special false/false");
    expect(restored.host.messages).toContain("vanity special result 0/0");
    expect(restored.session.state.cards.find((card) => card.uid === selfSummon!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentSummon!.uid)).toMatchObject({ location: "hand" });
  });
});
