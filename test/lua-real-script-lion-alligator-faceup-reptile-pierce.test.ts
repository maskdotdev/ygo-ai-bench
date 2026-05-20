import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const lionAlligatorCode = "4611269";
const reptileAttackerCode = "46112690";
const warriorAttackerCode = "46112691";
const openTargetCode = "46112692";
const typeMonster = 0x1;
const raceReptile = 0x80000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Lion Alligator face-up Reptile pierce", () => {
  it("restores condition-gated Reptile piercing for matching Reptile attackers", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${lionAlligatorCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_PIERCE)");
    expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsRace,RACE_REPTILE),e:GetHandlerPlayer(),LOCATION_MZONE,0,1,e:GetHandler())");
    expect(script).toContain("return c:IsRace(RACE_REPTILE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === lionAlligatorCode),
      { code: reptileAttackerCode, name: "Lion Alligator Reptile Attacker", kind: "monster", typeFlags: typeMonster, race: raceReptile, level: 4, attack: 2100, defense: 1000 },
      { code: warriorAttackerCode, name: "Lion Alligator Warrior Attacker", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 2100, defense: 1000 },
      { code: openTargetCode, name: "Lion Alligator Defense Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 1500 },
    ];
    const reader = createCardReader(cards);

    const nonReptile = createRestoredBattleWindow({ reader, workspace, attackerCode: warriorAttackerCode });
    expectCleanRestore(nonReptile);
    expectRestoredLegalActions(nonReptile, 1);
    passBattleResponses(nonReptile.session);
    expect(nonReptile.session.state.battleDamage[1]).toBe(0);
    expect(nonReptile.session.state.players[1].lifePoints).toBe(8000);
    expect(nonReptile.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([]);

    const restored = createRestoredBattleWindow({ reader, workspace, attackerCode: reptileAttackerCode });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    const alligator = requireCard(restored.session, lionAlligatorCode);
    expect(restored.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 203 && effect.sourceUid === alligator.uid)).toMatchObject({
      code: 203,
      range: ["monsterZone"],
      targetRange: [4, 0],
    });
    passBattleResponses(restored.session);
    expect(restored.session.state.battleDamage[1]).toBe(600);
    expect(restored.session.state.players[1].lifePoints).toBe(7400);
    const attacker = requireCard(restored.session, reptileAttackerCode);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: attacker.uid,
        eventPlayer: 1,
        eventValue: 600,
        eventReason: duelReason.battle,
        eventReasonCardUid: attacker.uid,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
  });
});

function createRestoredBattleWindow({
  reader,
  workspace,
  attackerCode,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  attackerCode: string;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 4611269 + Number(attackerCode), startingHandSize: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [lionAlligatorCode, attackerCode] }, 1: { main: [openTargetCode] } });
  startDuel(session);

  const alligator = requireCard(session, lionAlligatorCode);
  const attacker = requireCard(session, attackerCode);
  const target = requireCard(session, openTargetCode);
  moveDuelCard(session.state, alligator.uid, "monsterZone", 0).position = "faceUpAttack";
  alligator.faceUp = true;
  moveDuelCard(session.state, attacker.uid, "monsterZone", 0).position = "faceUpAttack";
  attacker.faceUp = true;
  moveDuelCard(session.state, target.uid, "monsterZone", 1).position = "faceUpDefense";
  target.faceUp = true;
  session.state.phase = "battle";
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(lionAlligatorCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === target.uid);
  expect(attack).toBeDefined();
  applyAndAssert(session, attack!);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
