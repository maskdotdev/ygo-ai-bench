import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceDragon = 0x2000;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Flash Charge Dragon force mzone summon lock", () => {
  it("restores EFFECT_FORCE_MZONE so linked zones cannot be used for Summon or Set", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const flashCode = "95372220";
    const candidateCode = "95372221";
    const blockerCodes = ["95372222", "95372223", "95372224"];
    const flashCard = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === flashCode);
    expect(flashCard).toBeDefined();
    const cards: DuelCardData[] = [
      { ...flashCard!, linkMarkers: 0x20 },
      { code: candidateCode, name: "Flash Charge Summon Candidate", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      ...blockerCodes.map((code, index) => ({
        code,
        name: `Flash Charge Zone Blocker ${index + 1}`,
        kind: "monster" as const,
        typeFlags: typeMonster | typeEffect,
        race: raceDragon,
        level: 4,
        attack: 1000,
        defense: 1000,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9537, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [candidateCode, ...blockerCodes], extra: [flashCode] }, 1: { main: [] } });
    startDuel(session);

    const flash = requireCard(session, flashCode);
    const candidate = requireCard(session, candidateCode);
    const blockers = blockerCodes.map((code) => requireCard(session, code));
    moveDuelCard(session.state, flash.uid, "monsterZone", 0);
    flash.sequence = 2;
    flash.faceUp = true;
    flash.position = "faceUpAttack";
    for (const [index, blocker] of blockers.entries()) {
      moveDuelCard(session.state, blocker.uid, "monsterZone", 0);
      blocker.sequence = [0, 1, 4][index]!;
      blocker.faceUp = true;
      blocker.position = "faceUpAttack";
    }
    moveDuelCard(session.state, candidate.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(flashCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const forceZoneEffect = session.state.effects.find((effect) => effect.code === 265 && effect.sourceUid === flash.uid);
    expect(forceZoneEffect).toMatchObject({ code: 265, sourceUid: flash.uid });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);

    const restoredActions = getLuaRestoreLegalActions(restored, 0);
    expect(restoredActions.some((action) => action.type === "normalSummon" && action.uid === candidate.uid)).toBe(false);
    expect(restoredActions.some((action) => action.type === "setMonster" && action.uid === candidate.uid)).toBe(false);

    const probe = restored.host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${flashCode}),0,LOCATION_MZONE,0,nil)
      Debug.Message("flash charge force mzone " .. tostring(c and (c:GetLinkedZone()&ZONES_MMZ)) .. "/" .. tostring(Duel.GetLocationCount(0,LOCATION_MZONE)))
      `,
      "flash-charge-force-mzone-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("flash charge force mzone 8/0");
  });

  it("restores EFFECT_FORCE_MZONE after Link materials leave the field", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const flashCode = "95372220";
    const linkCode = "95372225";
    const materialCode = "95372226";
    const blockerCodes = ["95372227", "95372228", "95372229"];
    const flashCard = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === flashCode);
    expect(flashCard).toBeDefined();
    const cards: DuelCardData[] = [
      { ...flashCard!, linkMarkers: 0x20 },
      { code: linkCode, name: "Flash Charge Link Probe", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, level: 1, attack: 1000, defense: 0, linkMaterials: [materialCode] },
      { code: materialCode, name: "Flash Charge Link Material", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      ...blockerCodes.map((code, index) => ({
        code,
        name: `Flash Charge Link Blocker ${index + 1}`,
        kind: "monster" as const,
        typeFlags: typeMonster | typeEffect,
        race: raceDragon,
        level: 4,
        attack: 1000,
        defense: 1000,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9538, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, ...blockerCodes], extra: [flashCode, linkCode] }, 1: { main: [] } });
    startDuel(session);

    const flash = requireCard(session, flashCode);
    const link = requireCard(session, linkCode);
    const material = requireCard(session, materialCode);
    const blockers = blockerCodes.map((code) => requireCard(session, code));
    moveDuelCard(session.state, flash.uid, "monsterZone", 0);
    flash.sequence = 2;
    flash.faceUp = true;
    flash.position = "faceUpAttack";
    moveDuelCard(session.state, material.uid, "monsterZone", 0);
    material.sequence = 3;
    material.faceUp = true;
    material.position = "faceUpAttack";
    for (const [index, blocker] of blockers.entries()) {
      moveDuelCard(session.state, blocker.uid, "monsterZone", 0);
      blocker.sequence = [0, 1, 4][index]!;
      blocker.faceUp = true;
      blocker.position = "faceUpAttack";
    }
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(flashCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const forceZoneEffect = session.state.effects.find((effect) => effect.code === 265 && effect.sourceUid === flash.uid);
    expect(forceZoneEffect).toMatchObject({ code: 265, sourceUid: flash.uid });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);

    const restoredActions = getLuaRestoreLegalActions(restored, 0);
    expect(restoredActions.some((action) => action.type === "linkSummon" && action.uid === link.uid)).toBe(false);

    const probe = restored.host.loadScript(
      `
      local g=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode,${materialCode}),0,LOCATION_MZONE,0,nil)
      Debug.Message("flash charge force mzone link material " .. tostring(Duel.GetMZoneCount(0,g)))
      `,
      "flash-charge-force-mzone-link-material-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("flash charge force mzone link material 0");
  });

  it("restores EFFECT_FORCE_MZONE after Tribute materials leave the field", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const flashCode = "95372220";
    const tributeCandidateCode = "95372230";
    const tributeCode = "95372231";
    const blockerCodes = ["95372232", "95372233", "95372234"];
    const flashCard = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === flashCode);
    expect(flashCard).toBeDefined();
    const cards: DuelCardData[] = [
      { ...flashCard!, linkMarkers: 0x20 },
      { code: tributeCandidateCode, name: "Flash Charge Tribute Candidate", kind: "monster", typeFlags: typeMonster | typeEffect, level: 5, normalTributes: 1, attack: 1800, defense: 1000 },
      { code: tributeCode, name: "Flash Charge Tribute", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      ...blockerCodes.map((code, index) => ({
        code,
        name: `Flash Charge Tribute Blocker ${index + 1}`,
        kind: "monster" as const,
        typeFlags: typeMonster | typeEffect,
        race: raceDragon,
        level: 4,
        attack: 1000,
        defense: 1000,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9539, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tributeCandidateCode, tributeCode, ...blockerCodes], extra: [flashCode] }, 1: { main: [] } });
    startDuel(session);

    const flash = requireCard(session, flashCode);
    const candidate = requireCard(session, tributeCandidateCode);
    const tribute = requireCard(session, tributeCode);
    const blockers = blockerCodes.map((code) => requireCard(session, code));
    moveDuelCard(session.state, flash.uid, "monsterZone", 0);
    flash.sequence = 2;
    flash.faceUp = true;
    flash.position = "faceUpAttack";
    moveDuelCard(session.state, tribute.uid, "monsterZone", 0);
    tribute.sequence = 3;
    tribute.faceUp = true;
    tribute.position = "faceUpAttack";
    moveDuelCard(session.state, candidate.uid, "hand", 0);
    for (const [index, blocker] of blockers.entries()) {
      moveDuelCard(session.state, blocker.uid, "monsterZone", 0);
      blocker.sequence = [0, 1, 4][index]!;
      blocker.faceUp = true;
      blocker.position = "faceUpAttack";
    }
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(flashCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const forceZoneEffect = session.state.effects.find((effect) => effect.code === 265 && effect.sourceUid === flash.uid);
    expect(forceZoneEffect).toMatchObject({ code: 265, sourceUid: flash.uid });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);

    const restoredActions = getLuaRestoreLegalActions(restored, 0);
    expect(restoredActions.some((action) => action.type === "tributeSummon" && action.uid === candidate.uid && action.tributeUids.length === 1 && action.tributeUids[0] === tribute.uid)).toBe(false);
    expect(restoredActions.some((action) => action.type === "tributeSet" && action.uid === candidate.uid && action.tributeUids.length === 1 && action.tributeUids[0] === tribute.uid)).toBe(false);

    const probe = restored.host.loadScript(
      `
      local g=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode,${tributeCode}),0,LOCATION_MZONE,0,nil)
      Debug.Message("flash charge force mzone tribute material " .. tostring(Duel.GetMZoneCount(0,g)))
      `,
      "flash-charge-force-mzone-tribute-material-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("flash charge force mzone tribute material 0");
  });

  it("restores EFFECT_FORCE_MZONE for control-change placement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const flashCode = "95372220";
    const targetCode = "95372235";
    const blockerCodes = ["95372236", "95372237", "95372238"];
    const flashCard = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === flashCode);
    expect(flashCard).toBeDefined();
    const cards: DuelCardData[] = [
      { ...flashCard!, linkMarkers: 0x20 },
      { code: targetCode, name: "Flash Charge Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      ...blockerCodes.map((code, index) => ({
        code,
        name: `Flash Charge Control Blocker ${index + 1}`,
        kind: "monster" as const,
        typeFlags: typeMonster | typeEffect,
        race: raceDragon,
        level: 4,
        attack: 1000,
        defense: 1000,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9540, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [...blockerCodes], extra: [flashCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const flash = requireCard(session, flashCode);
    const target = requireCard(session, targetCode);
    const blockers = blockerCodes.map((code) => requireCard(session, code));
    moveDuelCard(session.state, flash.uid, "monsterZone", 0);
    flash.sequence = 2;
    flash.faceUp = true;
    flash.position = "faceUpAttack";
    for (const [index, blocker] of blockers.entries()) {
      moveDuelCard(session.state, blocker.uid, "monsterZone", 0);
      blocker.sequence = [0, 1, 4][index]!;
      blocker.faceUp = true;
      blocker.position = "faceUpAttack";
    }
    moveDuelCard(session.state, target.uid, "monsterZone", 1);
    target.faceUp = true;
    target.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(flashCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const forceZoneEffect = session.state.effects.find((effect) => effect.code === 265 && effect.sourceUid === flash.uid);
    expect(forceZoneEffect).toMatchObject({ code: 265, sourceUid: flash.uid });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);

    const probe = restored.host.loadScript(
      `
      local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,0,LOCATION_MZONE,nil)
      Debug.Message("flash charge force mzone control count " .. tostring(Duel.GetLocationCount(0,LOCATION_MZONE,0,LOCATION_REASON_CONTROL)))
      Debug.Message("flash charge force mzone control predicate " .. tostring(target:IsAbleToChangeControler()))
      Debug.Message("flash charge force mzone control take " .. tostring(Duel.GetControl(target,0,0,0,LOCATION_MZONE)))
      `,
      "flash-charge-force-mzone-control-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("flash charge force mzone control count 0");
    expect(restored.host.messages).toContain("flash charge force mzone control predicate false");
    expect(restored.host.messages).toContain("flash charge force mzone control take 0");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
