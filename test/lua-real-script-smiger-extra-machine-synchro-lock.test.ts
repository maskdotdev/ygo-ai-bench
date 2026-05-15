import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Smiger Extra Machine Synchro lock", () => {
  it("restores its Race-then-Type Extra Deck-only Machine Synchro special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const smigerCode = "83443619";
    const machineSynchroCode = "900000322";
    const warriorSynchroCode = "900000323";
    const machineFusionCode = "900000324";
    const handWarriorCode = "900000325";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === smigerCode),
      { code: machineSynchroCode, name: "Smiger Machine Synchro Probe", kind: "monster", typeFlags: 0x2001, race: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: warriorSynchroCode, name: "Smiger Warrior Synchro Probe", kind: "monster", typeFlags: 0x2001, race: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: machineFusionCode, name: "Smiger Machine Fusion Probe", kind: "monster", typeFlags: 0x41, race: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: handWarriorCode, name: "Smiger Hand Warrior Probe", kind: "monster", typeFlags: 0x1, race: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 834, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [smigerCode, handWarriorCode], extra: [machineSynchroCode, warriorSynchroCode, machineFusionCode] }, 1: { main: [] } });
    startDuel(session);

    const smiger = session.state.cards.find((card) => card.code === smigerCode);
    const handWarrior = session.state.cards.find((card) => card.code === handWarriorCode);
    expect(smiger).toBeDefined();
    expect(handWarrior).toBeDefined();
    moveDuelCard(session.state, smiger!.uid, "monsterZone", 0);
    smiger!.position = "faceUpAttack";
    smiger!.faceUp = true;
    moveDuelCard(session.state, handWarrior!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(smigerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${smigerCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      c${smigerCode}.spop(e,0,nil,0,0,nil,0,0)
      `,
      "smiger-official-spop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);

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
      local machine_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${machineSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local warrior_synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${warriorSynchroCode}),0,LOCATION_EXTRA,0,nil)
      local machine_fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${machineFusionCode}),0,LOCATION_EXTRA,0,nil)
      local hand_warrior=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handWarriorCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("smiger warrior synchro special " .. Duel.SpecialSummon(warrior_synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("smiger machine fusion special " .. Duel.SpecialSummon(machine_fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("smiger machine synchro special " .. Duel.SpecialSummon(machine_synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("smiger hand warrior special " .. Duel.SpecialSummon(hand_warrior,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "smiger-extra-machine-synchro-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "smiger warrior synchro special 0",
        "smiger machine fusion special 0",
        "smiger machine synchro special 1",
        "smiger hand warrior special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
