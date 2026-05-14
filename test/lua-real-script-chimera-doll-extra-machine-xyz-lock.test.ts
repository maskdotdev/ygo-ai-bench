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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Chimera Doll Extra Machine Xyz lock", () => {
  it("restores its temporary Extra Deck-only Machine Xyz special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const chimeraCode = "97520532";
    const machineXyzCode = "900000307";
    const warriorXyzCode = "900000308";
    const machineFusionCode = "900000309";
    const handWarriorCode = "900000310";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === chimeraCode),
      { code: machineXyzCode, name: "Chimera Machine Xyz Probe", kind: "extra", typeFlags: 0x800001, race: 0x20, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: warriorXyzCode, name: "Chimera Warrior Xyz Probe", kind: "extra", typeFlags: 0x800001, race: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: machineFusionCode, name: "Chimera Machine Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x20, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: handWarriorCode, name: "Chimera Hand Warrior Probe", kind: "monster", typeFlags: 0x1, race: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 975, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [chimeraCode, handWarriorCode], extra: [machineXyzCode, warriorXyzCode, machineFusionCode] }, 1: { main: [] } });
    startDuel(session);

    const chimera = session.state.cards.find((card) => card.code === chimeraCode);
    const handWarrior = session.state.cards.find((card) => card.code === handWarriorCode);
    expect(chimera).toBeDefined();
    expect(handWarrior).toBeDefined();
    moveDuelCard(session.state, chimera!.uid, "monsterZone", 0);
    chimera!.position = "faceUpAttack";
    chimera!.faceUp = true;
    moveDuelCard(session.state, handWarrior!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(chimeraCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${chimeraCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      c${chimeraCode}.thtgop(e,0,nil,0,0,nil,0,0)
      `,
      "chimera-doll-official-thtgop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-type-race-extra:8388608:32",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const probe = restored.host.loadScript(
      `
      local machine_xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${machineXyzCode}),0,LOCATION_EXTRA,0,nil)
      local warrior_xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${warriorXyzCode}),0,LOCATION_EXTRA,0,nil)
      local machine_fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${machineFusionCode}),0,LOCATION_EXTRA,0,nil)
      local hand_warrior=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handWarriorCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("chimera warrior xyz special " .. Duel.SpecialSummon(warrior_xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("chimera machine fusion special " .. Duel.SpecialSummon(machine_fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("chimera machine xyz special " .. Duel.SpecialSummon(machine_xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("chimera hand warrior special " .. Duel.SpecialSummon(hand_warrior,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "chimera-doll-extra-machine-xyz-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "chimera warrior xyz special 0",
        "chimera machine fusion special 0",
        "chimera machine xyz special 1",
        "chimera hand warrior special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
