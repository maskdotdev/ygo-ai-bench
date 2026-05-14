import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Eldlixir Zombie special summon lock", () => {
  it("restores its temporary EFFECT_CANNOT_SPECIAL_SUMMON that allows only Zombies", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const eldlixirCode = "20612097";
    const deckZombieCode = "900000287";
    const handZombieCode = "900000288";
    const warriorCode = "900000289";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === eldlixirCode),
      { code: deckZombieCode, name: "Eldlixir Deck Zombie Probe", kind: "monster", typeFlags: 0x1, race: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: handZombieCode, name: "Eldlixir Hand Zombie Probe", kind: "monster", typeFlags: 0x1, race: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: warriorCode, name: "Eldlixir Warrior Probe", kind: "monster", typeFlags: 0x1, race: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 206, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [eldlixirCode, deckZombieCode, handZombieCode, warriorCode] }, 1: { main: [] } });
    startDuel(session);

    const eldlixir = session.state.cards.find((card) => card.code === eldlixirCode);
    const handZombie = session.state.cards.find((card) => card.code === handZombieCode);
    const warrior = session.state.cards.find((card) => card.code === warriorCode);
    expect(eldlixir).toBeDefined();
    expect(handZombie).toBeDefined();
    expect(warrior).toBeDefined();
    moveDuelCard(session.state, eldlixir!.uid, "hand", 0);
    moveDuelCard(session.state, handZombie!.uid, "hand", 0);
    moveDuelCard(session.state, warrior!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(eldlixirCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${eldlixirCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      c${eldlixirCode}.spop(e,0,nil,0,0,nil,0,0)
      `,
      "eldlixir-official-spop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    assertSpecialProbe(restored, handZombieCode, warriorCode, "locked", ["eldlixir can special locked true/false", "eldlixir warrior special locked 0", "eldlixir zombie special locked 1"]);

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});

function assertSpecialProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, zombieCode: string, warriorCode: string, label: string, expected: string[]): void {
  const probe = restored.host.loadScript(
    `
    local zombie=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${zombieCode}),0,LOCATION_HAND,0,nil)
    local warrior=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${warriorCode}),0,LOCATION_HAND,0,nil)
    Debug.Message("eldlixir can special ${label} " .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,zombie)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,warrior)))
    Debug.Message("eldlixir warrior special ${label} " .. Duel.SpecialSummon(warrior,0,0,0,false,false,POS_FACEUP_ATTACK))
    Debug.Message("eldlixir zombie special ${label} " .. Duel.SpecialSummon(zombie,0,0,0,false,false,POS_FACEUP_ATTACK))
    `,
    `eldlixir-zombie-special-lock-${label}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toEqual(expect.arrayContaining(expected));
}
