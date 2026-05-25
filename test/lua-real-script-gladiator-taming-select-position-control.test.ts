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
import type { LuaPromptOverride } from "#lua/host-types.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const tamingCode = "9780364";
const ownGladiatorCode = "97803640";
const opponentGladiatorCode = "97803641";
const opponentTargetCode = "97803642";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceBeastWarrior = 0x400000;
const attributeEarth = 0x4;
const setGladiator = 0x19;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gladiator Taming select position control", () => {
  it("restores SelectOption branches into position change and temporary control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${tamingCode}.lua`);
    expect(script).toContain("Duel.SelectOption(tp,aux.Stringid(id,0),aux.Stringid(id,1))");
    expect(script).toContain("Duel.SetTargetCard(sg)");
    expect(script).toContain("Duel.ChangePosition(tc,POS_FACEUP_DEFENSE,0,POS_FACEUP_ATTACK,0)");
    expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");

    const positionBranch = activateTamingBranch(workspace, 0);
    expect(positionBranch.session.state.cards.find((card) => card.uid === positionBranch.opponentGladiator.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
      position: "faceUpDefense",
    });
    expect(positionBranch.session.state.eventHistory.filter((event) => event.eventName === "positionChanged")).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: positionBranch.opponentGladiator.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: positionBranch.taming.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);

    const controlBranch = activateTamingBranch(workspace, 1);
    expect(controlBranch.session.state.cards.find((card) => card.uid === controlBranch.opponentGladiator.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: controlBranch.taming.uid,
      reasonEffectId: 1,
    });
    expect(controlBranch.session.state.eventHistory.filter((event) => event.eventName === "controlChanged")).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: controlBranch.opponentGladiator.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: controlBranch.taming.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
  });
});

function activateTamingBranch(workspace: ReturnType<typeof createUpstreamNodeWorkspace>, branch: 0 | 1): {
  session: DuelSession;
  taming: DuelCardInstance;
  opponentGladiator: DuelCardInstance;
  target: DuelCardInstance;
} {
  const cards: DuelCardData[] = [
    { code: tamingCode, name: "Gladiator Taming", kind: "spell", typeFlags: typeSpell },
    { code: ownGladiatorCode, name: "Own Gladiator", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, race: raceBeastWarrior, level: 4, attack: 1600, defense: 1200, setcodes: [setGladiator] },
    { code: opponentGladiatorCode, name: "Opponent Gladiator", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, race: raceBeastWarrior, level: 4, attack: 1700, defense: 1000, setcodes: [setGladiator] },
    { code: opponentTargetCode, name: "Opponent Position Target", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, race: raceBeastWarrior, level: 4, attack: 1800, defense: 900 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 9780364 + branch, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [tamingCode, ownGladiatorCode] }, 1: { main: [opponentGladiatorCode, opponentTargetCode] } });
  startDuel(session);

  const taming = requireCard(session, tamingCode);
  const ownGladiator = requireCard(session, ownGladiatorCode);
  const opponentGladiator = requireCard(session, opponentGladiatorCode);
  const target = requireCard(session, opponentTargetCode);
  moveDuelCard(session.state, taming.uid, "hand", 0);
  moveFaceUpAttack(session, ownGladiator, 0);
  moveFaceUpAttack(session, opponentGladiator, 1);
  moveFaceUpAttack(session, target, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const promptOverrides: LuaPromptOverride[] = [{ api: "SelectOption", player: 0, returned: branch }];
  const host = createLuaScriptHost(session, workspace, { promptOverrides });
  expect(host.loadCardScript(Number(tamingCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
    action.type === "activateEffect" && action.uid === taming.uid && action.effectId === "lua-1-1002"
  );
  expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, activate!);

  const restoredResult = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader, { promptOverrides });
  expectCleanRestore(restoredResult);
  return { session: restoredResult.session, taming, opponentGladiator, target };
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
