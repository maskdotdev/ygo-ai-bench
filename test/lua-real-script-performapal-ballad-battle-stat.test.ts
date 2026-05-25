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
const balladCode = "66768175";
const performapalCode = "667681750";
const opponentCode = "667681751";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBalladScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${balladCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceSpellcaster = 0x80;
const attributeEarth = 0x10;
const setPerformapal = 0x9f;

describe.skipIf(!hasUpstreamScripts || !hasBalladScript)("Lua real script Performapal Ballad battle stat", () => {
  it("restores its PZone battle-start and monster-zone battled attack reduction triggers", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${balladCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = { readScript(name: string) { return workspace.readScript(name) ?? ""; } };
    const session = createDuel({ seed: 66768175, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [balladCode, performapalCode] }, 1: { main: [opponentCode] } });
    startDuel(session);
    const ballad = requireCard(session, balladCode);
    const performapal = requireCard(session, performapalCode);
    const opponent = requireCard(session, opponentCode);
    moveToPZone(session, ballad, 0);
    moveFaceUpAttack(session, performapal, 0);
    moveFaceUpAttack(session, opponent, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(balladCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === ballad.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 320, event: "continuous", property: 263168, range: ["spellTrapZone"], sourceUid: ballad.uid, triggerEvent: undefined },
      { category: undefined, code: 1002, event: "ignition", property: undefined, range: ["hand"], sourceUid: ballad.uid, triggerEvent: undefined },
      { category: 2097152, code: 1132, event: "trigger", property: undefined, range: ["spellTrapZone"], sourceUid: ballad.uid, triggerEvent: "battleStarted" },
      { category: 2097152, code: 1138, event: "trigger", property: 16, range: ["monsterZone"], sourceUid: ballad.uid, triggerEvent: "afterDamageCalculation" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    pendulum(balladCode, "Performapal Ballad", 500),
    pendulum(performapalCode, "Performapal Ballad Ally", 1800),
    { code: opponentCode, name: "Performapal Ballad Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeEarth, level: 4, attack: 2200, defense: 1000 },
  ];
}

function pendulum(code: string, name: string, attack: number): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect | typePendulum,
    race: raceSpellcaster,
    attribute: attributeEarth,
    setcodes: [setPerformapal],
    level: 3,
    attack,
    defense: 1100,
    leftScale: 2,
    rightScale: 2,
  };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Performapal Ballad");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_START)");
  expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
  expect(script).toContain("tc:IsSetCard(SET_PERFORMAPAL)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-600)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLED)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("local atk=math.max(0,a:GetAttack())");
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
