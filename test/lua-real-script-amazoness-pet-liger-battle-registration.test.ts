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
const ligerCode = "68507541";
const amazonessCode = "685075410";
const opponentCode = "685075411";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLigerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ligerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const attributeEarth = 0x10;
const raceBeast = 0x4000;
const setAmazoness = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasLigerScript)("Lua real script Amazoness Pet Liger battle registration", () => {
  it("restores pre-damage, battled target, and battle-target restriction metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ligerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = { readScript(name: string) { return workspace.readScript(name) ?? ""; } };
    const session = createDuel({ seed: 68507541, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [amazonessCode], extra: [ligerCode] }, 1: { main: [opponentCode] } });
    startDuel(session);
    const liger = requireCard(session, ligerCode);
    const amazoness = requireCard(session, amazonessCode);
    const opponent = requireCard(session, opponentCode);
    const movedLiger = moveDuelCard(session.state, liger.uid, "monsterZone", 0);
    movedLiger.faceUp = true;
    movedLiger.position = "faceUpAttack";
    const movedAmazoness = moveDuelCard(session.state, amazoness.uid, "monsterZone", 0);
    movedAmazoness.faceUp = true;
    movedAmazoness.position = "faceUpAttack";
    const movedOpponent = moveDuelCard(session.state, opponent.uid, "monsterZone", 1);
    movedOpponent.faceUp = true;
    movedOpponent.position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ligerCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === liger.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: liger.uid, targetRange: undefined, triggerEvent: undefined },
      { category: 2097152, code: 1134, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], sourceUid: liger.uid, targetRange: undefined, triggerEvent: "beforeDamageCalculation" },
      { category: 2097152, code: 1138, event: "trigger", property: 16, range: ["monsterZone"], sourceUid: liger.uid, targetRange: undefined, triggerEvent: "afterDamageCalculation" },
      { category: undefined, code: 332, event: "continuous", property: undefined, range: ["monsterZone"], sourceUid: liger.uid, targetRange: [0, 4], triggerEvent: undefined },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    {
      code: ligerCode,
      name: "Amazoness Pet Liger",
      kind: "extra",
      typeFlags: typeMonster | typeEffect | typeFusion,
      race: raceBeast,
      attribute: attributeEarth,
      setcodes: [setAmazoness],
      level: 7,
      attack: 2500,
      defense: 2400,
      fusionMaterials: ["10979723"],
      fusionMaterialSetcode: setAmazoness,
    },
    amazoness(amazonessCode, "Amazoness Liger Ally", 1500),
    amazoness(opponentCode, "Amazoness Liger Opponent", 1800),
  ];
}

function amazoness(code: string, name: string, attack: number): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect,
    race: raceBeast,
    attribute: attributeEarth,
    setcodes: [setAmazoness],
    level: 4,
    attack,
    defense: 1000,
  };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Amazoness Pet Liger");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,10979723,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_AMAZONESS))");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLED)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e3:SetCode(EFFECT_CANNOT_SELECT_BATTLE_TARGET)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-800)");
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
