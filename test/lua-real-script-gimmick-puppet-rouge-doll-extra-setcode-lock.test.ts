import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gimmick Puppet Rouge Doll Extra setcode lock", () => {
  it("restores its Extra Deck-only Gimmick Puppet special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const rougeDollCode = "63825486";
    const gimmickXyzCode = "900000461";
    const offSetXyzCode = "900000462";
    const offSetFusionCode = "900000463";
    const level8GimmickCode = "900000464";
    const deckCode = "900000465";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === rougeDollCode),
      { code: gimmickXyzCode, name: "Rouge Doll Gimmick Puppet Xyz Probe", kind: "extra", typeFlags: 0x800001, setcodes: [0x1083], attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: offSetXyzCode, name: "Rouge Doll Off-Set Xyz Probe", kind: "extra", typeFlags: 0x800001, setcodes: [0x123], attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: offSetFusionCode, name: "Rouge Doll Off-Set Fusion Probe", kind: "extra", typeFlags: 0x41, setcodes: [0x123], attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: level8GimmickCode, name: "Rouge Doll Level 8 Gimmick Probe", kind: "monster", typeFlags: 0x1, setcodes: [0x1083], attribute: 0x10, level: 8, attack: 1000, defense: 1000 },
      { code: deckCode, name: "Rouge Doll Deck Probe", kind: "monster", typeFlags: 0x1, setcodes: [0x123], attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 638, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rougeDollCode, level8GimmickCode, deckCode], extra: [gimmickXyzCode, offSetXyzCode, offSetFusionCode] }, 1: { main: [] } });
    startDuel(session);
    const rougeDoll = session.state.cards.find((card) => card.code === rougeDollCode);
    expect(rougeDoll).toBeDefined();
    moveDuelCard(session.state, rougeDoll!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rougeDollCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const payCost = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${rougeDollCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      c${rougeDollCode}.spcost(e,0,nil,0,0,nil,0,0,1)
      `,
      "gimmick-puppet-rouge-doll-official-spcost.lua",
    );
    expect(payCost.ok, payCost.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-setcode-extra:4227",
    });

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
      local gimmick_xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${gimmickXyzCode}),0,LOCATION_EXTRA,0,nil)
      local off_set_xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${offSetXyzCode}),0,LOCATION_EXTRA,0,nil)
      local off_set_fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${offSetFusionCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("rouge off-set xyz special " .. Duel.SpecialSummon(off_set_xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("rouge off-set fusion special " .. Duel.SpecialSummon(off_set_fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("rouge gimmick xyz special " .. Duel.SpecialSummon(gimmick_xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("rouge deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "gimmick-puppet-rouge-doll-extra-setcode-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "rouge off-set xyz special 0",
        "rouge off-set fusion special 0",
        "rouge gimmick xyz special 1",
        "rouge deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
