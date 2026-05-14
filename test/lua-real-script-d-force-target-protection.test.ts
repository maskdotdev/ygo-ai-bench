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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script D - Force target protection", () => {
  it("restores official field-wide cannot-be-effect-target protection while Plasma is face-up", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dForceCode = "6186304";
    const plasmaCode = "83965310";
    const protectedCode = "900000274";
    const opponentSourceCode = "900000275";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [dForceCode, plasmaCode].includes(card.code)),
      { code: protectedCode, name: "D Force Protected Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: opponentSourceCode, name: "D Force Opponent Effect Source", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 618, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dForceCode, plasmaCode, protectedCode] }, 1: { main: [opponentSourceCode] } });
    startDuel(session);

    const dForce = session.state.cards.find((card) => card.code === dForceCode);
    const plasma = session.state.cards.find((card) => card.code === plasmaCode);
    const protectedCard = session.state.cards.find((card) => card.code === protectedCode);
    const opponentSource = session.state.cards.find((card) => card.code === opponentSourceCode);
    expect(dForce).toBeDefined();
    expect(plasma).toBeDefined();
    expect(protectedCard).toBeDefined();
    expect(opponentSource).toBeDefined();
    moveDuelCard(session.state, dForce!.uid, "spellTrapZone", 0);
    dForce!.position = "faceUpAttack";
    dForce!.faceUp = true;
    moveDuelCard(session.state, plasma!.uid, "monsterZone", 0);
    plasma!.position = "faceUpAttack";
    plasma!.faceUp = true;
    moveDuelCard(session.state, protectedCard!.uid, "monsterZone", 0);
    moveDuelCard(session.state, opponentSource!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dForceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 71,
          sourceUid: dForce!.uid,
          luaValueDescriptor: "cannot-be-effect-target:opponent",
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const probe = restored.host.loadScript(
      `
      local dforce=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${dForceCode}),0,LOCATION_SZONE,0,nil)
      local protected_card=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${protectedCode}),0,LOCATION_MZONE,0,nil)
      local opponent_source=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${opponentSourceCode}),1,LOCATION_HAND,0,nil)
      local own_effect=Effect.CreateEffect(dforce)
      local opponent_effect=Effect.CreateEffect(opponent_source)
      Debug.Message("dforce target protection " .. tostring(protected_card:IsCanBeEffectTarget(opponent_effect)) .. "/" .. tostring(protected_card:IsCanBeEffectTarget(own_effect)))
      `,
      "d-force-target-protection-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("dforce target protection false/true");
  });
});
