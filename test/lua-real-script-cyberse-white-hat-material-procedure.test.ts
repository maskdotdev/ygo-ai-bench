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
const whiteHatCode = "46104361";
const cyberseA = "461043610";
const cyberseB = "461043611";
const warrior = "461043612";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasWhiteHatScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${whiteHatCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeLight = 0x10;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasWhiteHatScript)("Lua real script Cyberse White Hat material procedure", () => {
  it("restores same-race hand procedure and delayed BE_MATERIAL ATK trigger metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${whiteHatCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = { readScript(name: string) { return workspace.readScript(name) ?? ""; } };

    const blocked = createRestoredWhiteHatWindow({ reader, source, workspace, fieldCase: "mixedRace" });
    expectCleanRestore(blocked);
    expectRestoredLegalActions(blocked, 0);
    expect(getLuaRestoreLegalActions(blocked, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const restored = createRestoredWhiteHatWindow({ reader, source, workspace, fieldCase: "sameRace" });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const whiteHat = requireCard(restored.session, whiteHatCode);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === whiteHat.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 34, event: "summonProcedure", property: 262144, range: ["hand"], sourceUid: whiteHat.uid, triggerEvent: undefined },
      { category: 2097152, code: 1108, event: "trigger", property: 65536, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], sourceUid: whiteHat.uid, triggerEvent: "usedAsMaterial" },
    ]);
    expect(getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === whiteHat.uid)).toMatchObject({
      label: "Special Summon Cyberse White Hat",
      windowKind: "open",
    });
  });
});

function createRestoredWhiteHatWindow({
  reader,
  source,
  workspace,
  fieldCase,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  fieldCase: "sameRace" | "mixedRace";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 46104361, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [whiteHatCode, cyberseA, cyberseB, warrior] }, 1: { main: [] } });
  startDuel(session);
  const whiteHat = requireCard(session, whiteHatCode);
  moveDuelCard(session.state, whiteHat.uid, "hand", 0);
  const first = moveDuelCard(session.state, requireCard(session, cyberseA).uid, "monsterZone", 0);
  first.faceUp = true;
  first.position = "faceUpAttack";
  const secondCode = fieldCase === "sameRace" ? cyberseB : warrior;
  const second = moveDuelCard(session.state, requireCard(session, secondCode).uid, "monsterZone", 0);
  second.faceUp = true;
  second.position = "faceUpAttack";
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(whiteHatCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function cards(): DuelCardData[] {
  return [
    monster(whiteHatCode, "Cyberse White Hat", raceCyberse),
    monster(cyberseA, "Cyberse White Hat Cyberse A", raceCyberse),
    monster(cyberseB, "Cyberse White Hat Cyberse B", raceCyberse),
    monster(warrior, "Cyberse White Hat Warrior Decoy", raceWarrior),
  ];
}

function monster(code: string, name: string, race: number): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect,
    race,
    attribute: attributeLight,
    level: 4,
    attack: 1000,
    defense: 1000,
  };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Cyberse White Hat");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,c:GetControler(),LOCATION_MZONE,0,1,nil,c:GetControler())");
  expect(script).toContain("e2:SetCode(EVENT_BE_MATERIAL)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("return c:IsLocation(LOCATION_GRAVE) and r==REASON_LINK");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-1000)");
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
