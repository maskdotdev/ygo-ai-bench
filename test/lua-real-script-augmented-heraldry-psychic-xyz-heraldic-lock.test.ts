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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Augmented Heraldry Psychic Xyz/Heraldic summon lock", () => {
  it("restores its Psychic Xyz or Heraldic Beast special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const heraldryCode = "59048135";
    const psychicXyzCode = "59048136";
    const heraldicCode = "59048137";
    const outsiderCode = "59048138";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === heraldryCode),
      { code: psychicXyzCode, name: "Augmented Heraldry Psychic Xyz Probe", kind: "extra", typeFlags: 0x800001, race: 0x100000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: heraldicCode, name: "Augmented Heraldry Heraldic Probe", kind: "monster", typeFlags: 0x1, setcodes: [0x76], race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: outsiderCode, name: "Augmented Heraldry Outsider Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 590, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [heraldryCode, heraldicCode, outsiderCode], extra: [psychicXyzCode] }, 1: { main: [] } });
    startDuel(session);
    for (const code of [heraldryCode, heraldicCode, outsiderCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(heraldryCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${heraldryCode}),0,LOCATION_HAND,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_OATH)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetTargetRange(1,0)
      e1:SetTarget(c${heraldryCode}.splimit)
      Duel.RegisterEffect(e1,0)
      `,
      "augmented-heraldry-official-psychic-xyz-heraldic-lock.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "target:not-race-type-or-setcode:1048576:8388608:118",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const probe = restored.host.loadScript(
      `
      local psychic_xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${psychicXyzCode}),0,LOCATION_EXTRA,0,nil)
      local heraldic=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${heraldicCode}),0,LOCATION_HAND,0,nil)
      local outsider=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${outsiderCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("augmented heraldry outsider special " .. Duel.SpecialSummon(outsider,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("augmented heraldry psychic xyz special " .. Duel.SpecialSummon(psychic_xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("augmented heraldry heraldic special " .. Duel.SpecialSummon(heraldic,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "augmented-heraldry-psychic-xyz-heraldic-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "augmented heraldry outsider special 0",
        "augmented heraldry psychic xyz special 1",
        "augmented heraldry heraldic special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
