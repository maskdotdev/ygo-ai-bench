import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, fusionSummonDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { luaSummonTypeFusion, luaSummonTypeLink, luaSummonTypeSynchro, luaSummonTypeXyz } from "#duel/summon-type-codes.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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
    expect(session.state.effects.find((effect) => effect.code === 248 && effect.sourceUid === concours!.uid)).toMatchInlineSnapshot(`
      {
        "battleDamageValue": [Function],
        "canActivate": [Function],
        "code": 248,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-1-248",
        "lifePointValue": [Function],
        "luaTargetDescriptor": "target:not-setcode-any:407,518",
        "luaTypeFlags": 2,
        "luaValueDescriptor": "cannot-material:controller-summon-types:1124073472,1174405120,1224736768,1275068416",
        "oncePerTurn": false,
        "operation": [Function],
        "ownerPlayer": 0,
        "promptOperation": [Function],
        "property": 384,
        "range": [
          "deck",
          "hand",
          "monsterZone",
          "spellTrapZone",
          "graveyard",
          "banished",
          "extraDeck",
          "overlay",
        ],
        "registryKey": "lua:14283055:lua-1-248",
        "sourceUid": "p0-deck-14283055-0",
        "statValue": [Function],
        "target": [Function],
        "targetCardPredicate": [Function],
        "targetRange": [
          1023,
          1023,
        ],
        "valueCardPredicate": [Function],
        "valuePredicate": [Function],
      }
    `);
    const materialLock = session.state.effects.find((effect) => effect.code === 248 && effect.sourceUid === concours!.uid);
    expect(materialLock).toBeDefined();

    const snapshot = serializeDuel(session);
    const restored = restoreDuelWithLuaScripts(snapshot, workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const actions = getLegalActions(restored.session, 0);
    expect(actions.some((action) => action.type === "fusionSummon" && action.uid === blockedFusion!.uid)).toBe(false);
    expect(actions.find((action) => action.type === "fusionSummon" && action.uid === allowedFusion!.uid)).toMatchObject({
      type: "fusionSummon",
      materialUids: [nouvelles!.uid, patissciel!.uid],
    });
    expect(restored.session.state.effects.find((effect) => effect.code === 248 && effect.sourceUid === concours!.uid)).toMatchInlineSnapshot(`
      {
        "code": 248,
        "controller": 0,
        "event": "continuous",
        "id": "lua-1-248",
        "luaTargetDescriptor": "target:not-setcode-any:407,518",
        "luaTypeFlags": 2,
        "luaValueDescriptor": "cannot-material:controller-summon-types:1124073472,1174405120,1224736768,1275068416",
        "oncePerTurn": false,
        "operation": [Function],
        "ownerPlayer": 0,
        "property": 384,
        "range": [
          "deck",
          "hand",
          "monsterZone",
          "spellTrapZone",
          "graveyard",
          "banished",
          "extraDeck",
          "overlay",
        ],
        "registryKey": "lua:14283055:lua-1-248",
        "sourceUid": "p0-deck-14283055-0",
        "targetCardPredicate": [Function],
        "targetRange": [
          1023,
          1023,
        ],
        "valuePredicate": [Function],
      }
    `);
    expect(() => fusionSummonDuelCard(restored.session.state, 0, blockedFusion!.uid, [blocked!.uid, helper!.uid])).toThrow("cannot be used as fusion material");

    const opponentRestored = restoreDuelWithLuaScripts(snapshot, workspace, reader);
    fusionSummonDuelCard(opponentRestored.session.state, 1, opponentFusion!.uid, [opponentBlocked!.uid, opponentHelper!.uid]);
    expect(opponentRestored.session.state.cards.find((card) => card.uid === opponentFusion!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
      summonType: "fusion",
    });
    expect(opponentRestored.session.state.cards.find((card) => card.uid === opponentBlocked!.uid)).toMatchObject({ location: "graveyard" });
    expect(opponentRestored.session.state.cards.find((card) => card.uid === opponentHelper!.uid)).toMatchObject({ location: "graveyard" });

    const allowedRestored = restoreDuelWithLuaScripts(snapshot, workspace, reader);
    fusionSummonDuelCard(allowedRestored.session.state, 0, allowedFusion!.uid, [nouvelles!.uid, patissciel!.uid]);
    expect(allowedRestored.session.state.cards.find((card) => card.uid === allowedFusion!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "fusion",
    });
    expect(allowedRestored.session.state.cards.find((card) => card.uid === nouvelles!.uid)).toMatchObject({ location: "graveyard" });
    expect(allowedRestored.session.state.cards.find((card) => card.uid === patissciel!.uid)).toMatchObject({ location: "graveyard" });
  });
});
