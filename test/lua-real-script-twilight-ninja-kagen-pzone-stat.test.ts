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
const kagenCode = "6830480";
const ninjaCode = "68304800";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasKagenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${kagenCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setNinja = 0x2b;

describe.skipIf(!hasUpstreamScripts || !hasKagenScript)("Lua real script Twilight Ninja Kagen PZone stat", () => {
  it("restores its Pendulum-zone summon limit and attack-announce stat trigger metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${kagenCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = { readScript(name: string) { return workspace.readScript(name) ?? ""; } };
    const session = createDuel({ seed: 6830480, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kagenCode, ninjaCode] }, 1: { main: [] } });
    startDuel(session);
    const kagen = requireCard(session, kagenCode);
    const ninja = requireCard(session, ninjaCode);
    moveToPZone(session, kagen, 0);
    moveFaceUpAttack(session, ninja, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kagenCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === kagen.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 320, event: "continuous", property: 263168, range: ["spellTrapZone"], sourceUid: kagen.uid, targetRange: undefined, triggerEvent: undefined },
      { category: undefined, code: 1002, event: "ignition", property: undefined, range: ["hand"], sourceUid: kagen.uid, targetRange: undefined, triggerEvent: undefined },
      { category: undefined, code: 22, event: "continuous", property: 3584, range: ["spellTrapZone"], sourceUid: kagen.uid, targetRange: [1, 0], triggerEvent: undefined },
      { category: 2097152, code: 1130, event: "trigger", property: undefined, range: ["spellTrapZone"], sourceUid: kagen.uid, targetRange: undefined, triggerEvent: "attackDeclared" },
      { category: 2097152, code: undefined, event: "ignition", property: 16, range: ["monsterZone"], sourceUid: kagen.uid, targetRange: undefined, triggerEvent: undefined },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    ninja(kagenCode, "Twilight Ninja Kagen", 1, 0),
    ninja(ninjaCode, "Twilight Ninja Kagen Ally", 4, 1700),
  ];
}

function ninja(code: string, name: string, level: number, attack: number): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect | typePendulum,
    race: raceWarrior,
    attribute: attributeDark,
    setcodes: [setNinja],
    level,
    attack,
    defense: 2000,
    leftScale: 10,
    rightScale: 10,
  };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Twilight Ninja Kagen");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CANNOT_NEGATE)");
  expect(script).toContain("e1:SetTargetRange(1,0)");
  expect(script).toContain("return not c:IsSetCard(SET_NINJA) and (sumtp&SUMMON_TYPE_PENDULUM)==SUMMON_TYPE_PENDULUM");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.GetAttacker()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("e3:SetCost(Cost.SelfTribute)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetValue(800)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveToPZone(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
