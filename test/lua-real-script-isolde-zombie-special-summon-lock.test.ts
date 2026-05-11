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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Isolde Zombie summon lock", () => {
  it("restores its Zombie-only special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const isoldeCode = "22657402";
    const zombieCode = "519";
    const fiendCode = "520";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === isoldeCode),
      { code: zombieCode, name: "Isolde Zombie Probe", kind: "monster", typeFlags: 0x1, race: 0x10, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: fiendCode, name: "Isolde Fiend Probe", kind: "monster", typeFlags: 0x1, race: 0x8, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 226, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [isoldeCode, zombieCode, fiendCode] }, 1: { main: [] } });
    startDuel(session);
    for (const code of [isoldeCode, zombieCode, fiendCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(isoldeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${isoldeCode}),0,LOCATION_HAND,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      e1:SetTargetRange(1,0)
      e1:SetTarget(c${isoldeCode}.splimit)
      Duel.RegisterEffect(e1,0)
      `,
      "isolde-official-zombie-splimit.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "target:not-race:16",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const probe = restored.host.loadScript(
      `
      local zombie=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${zombieCode}),0,LOCATION_HAND,0,nil)
      local fiend=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fiendCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("isolde fiend special " .. Duel.SpecialSummon(fiend,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("isolde zombie special " .. Duel.SpecialSummon(zombie,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "isolde-zombie-summon-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "isolde fiend special 0",
        "isolde zombie special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
