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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cyanos Extra Machine lock", () => {
  it("restores its reversed-order Extra Deck-only non-Machine special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cyanosCode = "20357457";
    const machineExtraCode = "900000319";
    const warriorExtraCode = "900000320";
    const warriorHandCode = "900000321";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cyanosCode),
      { code: machineExtraCode, name: "Cyanos Machine Extra Probe", kind: "monster", typeFlags: 0x41, race: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: warriorExtraCode, name: "Cyanos Warrior Extra Probe", kind: "monster", typeFlags: 0x41, race: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: warriorHandCode, name: "Cyanos Warrior Hand Probe", kind: "monster", typeFlags: 0x1, race: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 203, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cyanosCode, warriorHandCode], extra: [machineExtraCode, warriorExtraCode] }, 1: { main: [] } });
    startDuel(session);

    const cyanos = session.state.cards.find((card) => card.code === cyanosCode);
    const warriorHand = session.state.cards.find((card) => card.code === warriorHandCode);
    expect(cyanos).toBeDefined();
    expect(warriorHand).toBeDefined();
    moveDuelCard(session.state, cyanos!.uid, "monsterZone", 0);
    cyanos!.position = "faceUpAttack";
    cyanos!.faceUp = true;
    moveDuelCard(session.state, warriorHand!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cyanosCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${cyanosCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      c${cyanosCode}.rozespop(e,0,nil,0,0,nil,0,0)
      `,
      "cyanos-official-rozespop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const probe = restored.host.loadScript(
      `
      local machine_extra=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${machineExtraCode}),0,LOCATION_EXTRA,0,nil)
      local warrior_extra=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${warriorExtraCode}),0,LOCATION_EXTRA,0,nil)
      local warrior_hand=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${warriorHandCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("cyanos warrior extra special " .. Duel.SpecialSummon(warrior_extra,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("cyanos machine extra special " .. Duel.SpecialSummon(machine_extra,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("cyanos warrior hand special " .. Duel.SpecialSummon(warrior_hand,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "cyanos-extra-machine-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining(["cyanos warrior extra special 0", "cyanos machine extra special 1", "cyanos warrior hand special 1"]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
