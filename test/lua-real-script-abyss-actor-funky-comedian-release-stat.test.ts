import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const funkyCode = "99634927";
const releaseActorCode = "996349270";
const targetActorCode = "996349271";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFunkyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${funkyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceFiend = 0x8;
const attributeDark = 0x20;
const setAbyssActor = 0x10ec;
const effectCannotAttack = 85;
const effectUpdateAttack = 100;
const allLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasFunkyScript)("Lua real script Abyss Actor Funky Comedian release stat", () => {
  it("restores PZone release-cost ATK transfer plus summon and monster-zone stat metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${funkyCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 99634927, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [funkyCode, releaseActorCode, targetActorCode] }, 1: { main: [] } });
    startDuel(session);

    const funky = requireCard(session, funkyCode);
    const releaseActor = requireCard(session, releaseActorCode);
    const targetActor = requireCard(session, targetActorCode);
    moveToPZone(session, funky, 0);
    moveFaceUpAttack(session, releaseActor, 0);
    moveFaceUpAttack(session, targetActor, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(funkyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === funky.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 320, event: "continuous", property: 263168, range: ["spellTrapZone"], sourceUid: funky.uid, triggerEvent: undefined },
      { category: undefined, code: 1002, event: "ignition", property: undefined, range: ["hand"], sourceUid: funky.uid, triggerEvent: undefined },
      { category: 2097152, code: undefined, event: "ignition", property: 16, range: ["spellTrapZone"], sourceUid: funky.uid, triggerEvent: undefined },
      { category: 2097152, code: 1100, event: "trigger", property: 65536, range: allLocations, sourceUid: funky.uid, triggerEvent: "normalSummoned" },
      { category: 2097152, code: 1102, event: "trigger", property: 65536, range: allLocations, sourceUid: funky.uid, triggerEvent: "specialSummoned" },
      { category: 2097152, code: undefined, event: "ignition", property: 16, range: ["monsterZone"], sourceUid: funky.uid, triggerEvent: undefined },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === funky.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === targetActor.uid), restoredResolved.session.state)).toBe(3200);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === releaseActor.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: funky.uid,
      reasonEffectId: 3,
    });
    expect(restoredResolved.session.state.effects.filter((effect) =>
      (effect.sourceUid === targetActor.uid && effect.code === effectUpdateAttack) ||
      (effect.sourceUid === funky.uid && effect.code === effectCannotAttack)
    ).map((effect) => ({
      code: effect.code,
      description: effect.description,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, description: undefined, property: undefined, reset: { flags: 1107169792 }, sourceUid: targetActor.uid, value: 1800 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    abyssActor(funkyCode, "Abyss Actor - Funky Comedian", 300, true),
    abyssActor(releaseActorCode, "Funky Comedian Release Actor", 1800, false),
    abyssActor(targetActorCode, "Funky Comedian Target Actor", 1400, false),
  ];
}

function abyssActor(code: string, name: string, attack: number, pendulum: boolean): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect | (pendulum ? typePendulum : 0),
    race: raceFiend,
    attribute: attributeDark,
    setcodes: [setAbyssActor],
    level: 4,
    attack,
    defense: 1000,
    ...(pendulum ? { leftScale: 8, rightScale: 8 } : {}),
  };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Abyss Actor - Funky Comedian");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.atkfilter1,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.atkfilter1,1,1,false,nil,nil,tp)");
  expect(script).toContain("e:SetLabel(g:GetFirst():GetBaseAttack())");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter2,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.atkfilter2,tp,LOCATION_MZONE,0,nil)*300");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e1:SetDescription(3206)");
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
