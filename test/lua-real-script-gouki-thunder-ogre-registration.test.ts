import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const thunderOgreCode = "30010480";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasThunderOgreScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${thunderOgreCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const attributeEarth = 0x10;
const raceWarrior = 0x1;
const setGouki = 0xfc;

describe.skipIf(!hasUpstreamScripts || !hasThunderOgreScript)("Lua real script Gouki Thunder Ogre registration", () => {
  it("restores Link procedure, extra summon count, and delayed destroyed ATK trigger metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${thunderOgreCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = { readScript(name: string) { return workspace.readScript(name) ?? ""; } };
    const session = createDuel({ seed: 30010480, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [thunderOgreCode] }, 1: { main: [] } });
    startDuel(session);
    const thunderOgre = requireCard(session, thunderOgreCode);
    const moved = moveDuelCard(session.state, thunderOgre.uid, "monsterZone", 0);
    moved.faceUp = true;
    moved.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(thunderOgreCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const restoredThunderOgre = requireCard(restored.session, thunderOgreCode);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === restoredThunderOgre.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: restoredThunderOgre.uid, targetRange: undefined, triggerEvent: undefined },
      { category: undefined, code: 29, event: "continuous", property: undefined, range: ["monsterZone"], sourceUid: restoredThunderOgre.uid, targetRange: [2, 2], triggerEvent: undefined },
      { category: 2097152, code: 1029, event: "trigger", property: 81920, range: ["monsterZone"], sourceUid: restoredThunderOgre.uid, targetRange: undefined, triggerEvent: "destroyed" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    {
      code: thunderOgreCode,
      name: "Gouki Thunder Ogre",
      kind: "extra",
      typeFlags: typeMonster | typeEffect | typeLink,
      race: raceWarrior,
      attribute: attributeEarth,
      setcodes: [setGouki],
      level: 3,
      attack: 2200,
      defense: 0,
      linkMarkers: 0x88,
      linkMaterialMin: 2,
      linkMaterialSetcode: setGouki,
    },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Gouki Thunder Ogre");
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_GOUKI),2)");
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("e1:SetCode(EFFECT_EXTRA_SUMMON_COUNT)");
  expect(script).toContain("e1:SetTargetRange(LOCATION_HAND,LOCATION_HAND)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
  expect(script).toContain("e:GetHandler():GetLinkedZone()");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
  expect(script).toContain("e1:SetValue(400)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
