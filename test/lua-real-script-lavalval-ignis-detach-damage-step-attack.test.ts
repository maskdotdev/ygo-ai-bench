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
const ignisCode = "3989465";
const materialCode = "39894650";
const defenderCode = "39894651";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasIgnisScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ignisCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasIgnisScript)("Lua real script Lavalval Ignis detach damage-step attack", () => {
  it("restores Damage Step detach once-per-battle cost into self ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ignisCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredBattle({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const ignis = requireCard(restored.session, ignisCode);
    const material = requireCard(restored.session, materialCode);
    const defender = requireCard(restored.session, defenderCode);
    const attack = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === ignis.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attack!);
    passUntilRestoredAction(restored, 0, ignis.uid);

    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === ignis.uid && action.effectId === "lua-2-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === ignis.uid)?.overlayUids).toEqual([]);
    expect(findCard(restored.session, material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: ignis.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restored.session, ignis.uid)).toMatchObject({ attackModifier: 500 });
    expect(currentAttack(findCard(restored.session, ignis.uid), restored.session.state)).toBe(2300);
    expect(restored.session.state.eventHistory.filter((event) => ["attackDeclared", "detachedMaterial"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "monsterZone", eventCardUid: ignis.uid, eventCode: 1130, eventName: "attackDeclared", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "extraDeck", relatedEffectId: undefined },
      { current: "graveyard", eventCardUid: material.uid, eventCode: 1202, eventName: "detachedMaterial", eventReason: duelReason.cost, eventReasonCardUid: ignis.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "overlay", relatedEffectId: undefined },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const ignis = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === ignisCode);
  expect(ignis).toBeDefined();
  return [
    ignis!,
    { code: materialCode, name: "Lavalval Ignis Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 3, attack: 1000, defense: 1000 },
    { code: defenderCode, name: "Lavalval Ignis Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 2200, defense: 1000 },
  ];
}

function createRestoredBattle({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 3989465, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialCode], extra: [ignisCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  const ignis = requireCard(session, ignisCode);
  const material = requireCard(session, materialCode);
  moveFaceUpAttack(session, ignis, 0, 0);
  moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
  ignis.overlayUids.push(material.uid);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ignisCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Lavalval Ignis");
  expect(script).toContain("Xyz.AddProcedure(c,nil,3,2)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCondition(s.atkcon)");
  expect(script).toContain("Cost.AND(Cost.DetachFromSelf(1),Cost.SoftOncePerBattle(id))");
  expect(script).toContain("return e:GetHandler():IsRelateToBattle() and Duel.IsPhase(PHASE_DAMAGE) and aux.StatChangeDamageStepCondition()");
  expect(script).toContain("c:UpdateAttack(500,RESETS_STANDARD_DISABLE_PHASE_END)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
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

function passUntilRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, uid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, player).some((action) => action.type === "activateEffect" && action.uid === uid)) {
    expect(++guard).toBeLessThan(20);
    const actionPlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, actionPlayer).find((action) => action.type === "passChain" || action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, actionPlayer), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
