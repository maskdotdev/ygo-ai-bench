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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Tatsunecro Zombie special summon lock", () => {
  it("restores official filtered EFFECT_CANNOT_SPECIAL_SUMMON and allows only Zombie summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const tatsunecroCode = "3096468";
    const zombieCode = "900000278";
    const warriorCode = "900000279";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === tatsunecroCode),
      { code: zombieCode, name: "Tatsunecro Zombie Probe", kind: "monster", typeFlags: 0x1, race: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: warriorCode, name: "Tatsunecro Warrior Probe", kind: "monster", typeFlags: 0x1, race: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 309, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tatsunecroCode, zombieCode, warriorCode] }, 1: { main: [] } });
    startDuel(session);

    const tatsunecro = session.state.cards.find((card) => card.code === tatsunecroCode);
    const zombie = session.state.cards.find((card) => card.code === zombieCode);
    const warrior = session.state.cards.find((card) => card.code === warriorCode);
    expect(tatsunecro).toBeDefined();
    expect(zombie).toBeDefined();
    expect(warrior).toBeDefined();
    moveDuelCard(session.state, tatsunecro!.uid, "monsterZone", 0);
    tatsunecro!.position = "faceUpAttack";
    tatsunecro!.faceUp = true;
    moveDuelCard(session.state, zombie!.uid, "hand", 0);
    moveDuelCard(session.state, warrior!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tatsunecroCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 22,
          sourceUid: tatsunecro!.uid,
          targetRange: [1, 0],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const probe = restored.host.loadScript(
      `
      local zombie=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${zombieCode}),0,LOCATION_HAND,0,nil)
      local warrior=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${warriorCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("tatsunecro can special " .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,zombie)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,warrior)))
      Debug.Message("tatsunecro warrior special " .. Duel.SpecialSummon(warrior,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("tatsunecro zombie special " .. Duel.SpecialSummon(zombie,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "tatsunecro-zombie-special-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("tatsunecro can special true/false");
    expect(restored.host.messages).toContain("tatsunecro warrior special 0");
    expect(restored.host.messages).toContain("tatsunecro zombie special 1");
    expect(restored.session.state.cards.find((card) => card.uid === warrior!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === zombie!.uid)).toMatchObject({ location: "monsterZone" });
  });
});
