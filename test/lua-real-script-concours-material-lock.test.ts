import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, fusionSummonDuelCard, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { luaSummonTypeFusion, luaSummonTypeLink, luaSummonTypeSynchro, luaSummonTypeXyz } from "#duel/summon-type-codes.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Concours de Cuisine material lock", () => {
  it("restores its own-player non-Nouvelles/non-Patissciel material lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const concoursCode = "14283055";
    const blockedCode = "900000270";
    const helperCode = "900000271";
    const nouvellesCode = "900000272";
    const patisscielCode = "900000273";
    const blockedFusionCode = "900000274";
    const allowedFusionCode = "900000275";
    const opponentFusionCode = "900000276";
    const setNouvelles = 0x197;
    const setPatissciel = 0x206;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === concoursCode),
      { code: blockedCode, name: "Blocked Cuisine Material", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: helperCode, name: "Cuisine Helper Material", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: nouvellesCode, name: "Nouvelles Material", kind: "monster", typeFlags: 0x1, setcodes: [setNouvelles], level: 4, attack: 1000, defense: 1000 },
      { code: patisscielCode, name: "Patissciel Material", kind: "monster", typeFlags: 0x1, setcodes: [setPatissciel], level: 4, attack: 1000, defense: 1000 },
      { code: blockedFusionCode, name: "Blocked Cuisine Fusion", kind: "extra", typeFlags: 0x41, level: 8, attack: 2000, defense: 2000, fusionMaterials: [blockedCode, helperCode] },
      { code: allowedFusionCode, name: "Allowed Cuisine Fusion", kind: "extra", typeFlags: 0x41, level: 8, attack: 2000, defense: 2000, fusionMaterials: [nouvellesCode, patisscielCode] },
      { code: opponentFusionCode, name: "Opponent Cuisine Fusion", kind: "extra", typeFlags: 0x41, level: 8, attack: 2000, defense: 2000, fusionMaterials: [blockedCode, helperCode] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 142, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [concoursCode, blockedCode, helperCode, nouvellesCode, patisscielCode], extra: [blockedFusionCode, allowedFusionCode] },
      1: { main: [blockedCode, helperCode], extra: [opponentFusionCode] },
    });
    startDuel(session);

    for (const card of session.state.cards.filter((candidate) => candidate.kind === "monster")) moveDuelCard(session.state, card.uid, "monsterZone", card.controller);
    const concours = session.state.cards.find((card) => card.code === concoursCode);
    const blocked = session.state.cards.find((card) => card.code === blockedCode && card.controller === 0);
    const helper = session.state.cards.find((card) => card.code === helperCode && card.controller === 0);
    const nouvelles = session.state.cards.find((card) => card.code === nouvellesCode);
    const patissciel = session.state.cards.find((card) => card.code === patisscielCode);
    const blockedFusion = session.state.cards.find((card) => card.code === blockedFusionCode);
    const allowedFusion = session.state.cards.find((card) => card.code === allowedFusionCode);
    const opponentBlocked = session.state.cards.find((card) => card.code === blockedCode && card.controller === 1);
    const opponentHelper = session.state.cards.find((card) => card.code === helperCode && card.controller === 1);
    const opponentFusion = session.state.cards.find((card) => card.code === opponentFusionCode);
    expect(concours).toBeDefined();
    moveDuelCard(session.state, concours!.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(concoursCode), workspace).ok).toBe(true);
    const setup = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, Card.IsCode, 0, LOCATION_GRAVE, 0, 1, 1, nil, ${concoursCode}):GetFirst()
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetProperty(EFFECT_FLAG_SET_AVAILABLE+EFFECT_FLAG_IGNORE_IMMUNE)
      e1:SetCode(EFFECT_CANNOT_BE_MATERIAL)
      e1:SetTargetRange(LOCATION_ALL,LOCATION_ALL)
      e1:SetTarget(function(e,c) return not c:IsSetCard({SET_NOUVELLES,SET_PATISSCIEL}) end)
      e1:SetValue(c${concoursCode}.sumlimit)
      Duel.RegisterEffect(e1,0)
      `,
      "concours-material-lock-setup.lua",
    );
    expect(setup.error).toBeUndefined();
    expect(setup.ok).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 248,
          luaTargetDescriptor: `target:not-setcode-any:${setNouvelles},${setPatissciel}`,
          luaValueDescriptor: `cannot-material:controller-summon-types:${luaSummonTypeFusion},${luaSummonTypeSynchro},${luaSummonTypeXyz},${luaSummonTypeLink}`,
        }),
      ]),
    );
    const materialLock = session.state.effects.find((effect) => effect.code === 248 && effect.sourceUid === concours!.uid);
    expect(materialLock).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 248,
          sourceUid: concours!.uid,
          luaTargetDescriptor: `target:not-setcode-any:${setNouvelles},${setPatissciel}`,
          luaValueDescriptor: `cannot-material:controller-summon-types:${luaSummonTypeFusion},${luaSummonTypeSynchro},${luaSummonTypeXyz},${luaSummonTypeLink}`,
        }),
      ]),
    );
    expect(() => fusionSummonDuelCard(restored.session.state, 0, blockedFusion!.uid, [blocked!.uid, helper!.uid])).toThrow("cannot be used as fusion material");
    expect(() => fusionSummonDuelCard(restored.session.state, 1, opponentFusion!.uid, [opponentBlocked!.uid, opponentHelper!.uid])).not.toThrow();
    expect(() => fusionSummonDuelCard(restored.session.state, 0, allowedFusion!.uid, [nouvelles!.uid, patissciel!.uid])).not.toThrow();
  });
});
