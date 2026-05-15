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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fusion Draft Extra Fusion lock", () => {
  it("restores its named Fusion Extra Deck special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const draftCode = "55158350";
    const discardCode = "900000355";
    const listedFusionCode = "900000356";
    const materialCode = "900000357";
    const fusionCode = "900000358";
    const synchroCode = "900000359";
    const xyzCode = "900000360";
    const handCode = "900000361";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === draftCode),
      { code: discardCode, name: "Fusion Draft Discard Probe", kind: "monster", typeFlags: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: listedFusionCode, name: "Fusion Draft Listed Fusion Probe", kind: "extra", typeFlags: 0x41, attribute: 0x10, level: 4, attack: 1000, defense: 1000, fusionMaterials: [materialCode] },
      { code: materialCode, name: "Fusion Draft Material Probe", kind: "monster", typeFlags: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: fusionCode, name: "Fusion Draft Fusion Probe", kind: "extra", typeFlags: 0x41, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: synchroCode, name: "Fusion Draft Synchro Probe", kind: "extra", typeFlags: 0x2001, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: xyzCode, name: "Fusion Draft Xyz Probe", kind: "extra", typeFlags: 0x800001, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: handCode, name: "Fusion Draft Hand Probe", kind: "monster", typeFlags: 0x1, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 551, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [draftCode, discardCode, materialCode, handCode], extra: [listedFusionCode, fusionCode, synchroCode, xyzCode] }, 1: { main: [] } });
    startDuel(session);

    for (const code of [draftCode, discardCode, handCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(draftCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      c${listedFusionCode}={material={${materialCode}}}
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${draftCode}),0,LOCATION_HAND,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      c${draftCode}.cost(e,0,nil,0,0,nil,0,0,1)
      c${draftCode}.activate(e,0,nil,0,0,nil,0,0)
      `,
      "fusion-draft-official-activate.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:non-fusion-extra",
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
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,nil)
      local synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${synchroCode}),0,LOCATION_EXTRA,0,nil)
      local xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${xyzCode}),0,LOCATION_EXTRA,0,nil)
      local hand=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("fusion draft synchro special " .. Duel.SpecialSummon(synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("fusion draft xyz special " .. Duel.SpecialSummon(xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("fusion draft fusion special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("fusion draft hand special " .. Duel.SpecialSummon(hand,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "fusion-draft-extra-fusion-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "fusion draft synchro special 0",
        "fusion draft xyz special 0",
        "fusion draft fusion special 1",
        "fusion draft hand special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
