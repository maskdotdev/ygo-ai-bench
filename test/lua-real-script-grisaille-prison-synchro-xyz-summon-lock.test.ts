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
import { luaSummonTypeFusion, luaSummonTypeSynchro, luaSummonTypeXyz } from "#duel/summon-type-codes.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Grisaille Prison Synchro/Xyz summon lock", () => {
  it("restores its multi summon-type lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const prisonCode = "22888900";
    const synchroCode = "22888901";
    const xyzCode = "22888902";
    const fusionCode = "22888903";
    const handCode = "22888904";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === prisonCode),
      { code: synchroCode, name: "Grisaille Synchro Probe", kind: "extra", typeFlags: 0x2001, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: xyzCode, name: "Grisaille Xyz Probe", kind: "extra", typeFlags: 0x800001, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: fusionCode, name: "Grisaille Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: handCode, name: "Grisaille Hand Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 228, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [prisonCode, handCode], extra: [synchroCode, xyzCode, fusionCode] }, 1: { main: [] } });
    startDuel(session);
    for (const code of [prisonCode, handCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(prisonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${prisonCode}),0,LOCATION_HAND,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
      e1:SetTargetRange(1,1)
      e1:SetTarget(c${prisonCode}.splimit)
      Duel.RegisterEffect(e1,0)
      `,
      "grisaille-prison-official-synchro-xyz-lock.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: `target:special-summon-type-is-any:${luaSummonTypeSynchro},${luaSummonTypeXyz}`,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const probe = restored.host.loadScript(
      `
      local synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${synchroCode}),0,LOCATION_EXTRA,0,nil)
      local xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${xyzCode}),0,LOCATION_EXTRA,0,nil)
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,nil)
      local hand=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("grisaille synchro special " .. Duel.SpecialSummon(synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("grisaille xyz special " .. Duel.SpecialSummon(xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("grisaille fusion special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("grisaille hand special " .. Duel.SpecialSummon(hand,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "grisaille-prison-synchro-xyz-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "grisaille synchro special 0",
        "grisaille xyz special 0",
        "grisaille fusion special 1",
        "grisaille hand special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
