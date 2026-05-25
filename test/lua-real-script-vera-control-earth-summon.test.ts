import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const veraCode = "55125728";
const opponentTargetCode = "551257280";
const earthGraveCode = "551257281";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasVeraScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${veraCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFairy = 0x4;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeFire = 0x4;
const effectChangeAttribute = 127;
const eventFreeChain = 1002;

describe.skipIf(!hasUpstreamScripts || !hasVeraScript)("Lua real script Vera control earth summon", () => {
  it("restores targeted control and makes the received monster EARTH", () => {
    const { workspace, reader, session } = createFixture(55125728);
    expectScriptShape(workspace.readScript(`official/c${veraCode}.lua`) ?? "");
    const vera = requireCard(session, veraCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveFaceUpAttack(session, vera, 0);
    moveFaceUpAttack(session, opponentTarget, 1);
    prepareMainPhase(session, 0);
    registerVera(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === vera.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 1020, event: "continuous", id: "lua-1-1020", property: undefined, range: ["monsterZone"] },
      { category: 0x2000, code: undefined, event: "ignition", id: "lua-2", property: 0x10, range: ["monsterZone"] },
      { category: 0x200, code: eventFreeChain, event: "quick", id: `lua-3-${eventFreeChain}`, property: 0x10, range: ["monsterZone"] },
    ]);

    const control = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === vera.uid && action.effectId === "lua-2");
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, control!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: vera.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === opponentTarget.uid && effect.code === effectChangeAttribute).map((effect) => ({
      code: effect.code,
      property: effect.property,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeAttribute, property: 0x400, sourceUid: opponentTarget.uid, value: attributeEarth },
    ]);
  });

  it("restores opponent-turn Quick Effect that Special Summons an EARTH monster from the graveyard", () => {
    const { workspace, reader, session } = createFixture(55125729);
    const vera = requireCard(session, veraCode);
    const earthGrave = requireCard(session, earthGraveCode);
    moveFaceUpAttack(session, vera, 0);
    moveDuelCard(session.state, earthGrave.uid, "graveyard", 0).faceUp = true;
    prepareMainPhase(session, 1);
    registerVera(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === vera.uid && action.effectId === `lua-3-${eventFreeChain}`);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === earthGrave.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: vera.uid,
      reasonEffectId: 3,
    });
  });
});

function createFixture(seed: number): {
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  reader: ReturnType<typeof createCardReader>;
  session: DuelSession;
} {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [veraCode, earthGraveCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: veraCode, name: "Vera the Vernusylph Goddess", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeEarth, level: 8, attack: 2400, defense: 3000 },
    { code: opponentTargetCode, name: "Vera Opponent FIRE Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1700, defense: 1000 },
    { code: earthGraveCode, name: "Vera EARTH Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("Vera the Vernusylph Goddess");
  expect(script).toContain("Duel.IsChainDisablable(ev)");
  expect(script).toContain("Duel.SelectEffectYesNo(tp,c)");
  expect(script).toContain("Duel.NegateEffect(ev)");
  expect(script).toContain("Duel.Destroy(rc,REASON_EFFECT)");
  expect(script).toContain("Duel.GetControl(tc,tp)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_ATTRIBUTE)");
  expect(script).toContain("e3:SetCondition(function(_,tp) return Duel.IsTurnPlayer(1-tp) end)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
}

function prepareMainPhase(session: DuelSession, turnPlayer: PlayerId): void {
  session.state.phase = "main1";
  session.state.turnPlayer = turnPlayer;
  session.state.waitingFor = 0;
}

function registerVera(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(veraCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
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
