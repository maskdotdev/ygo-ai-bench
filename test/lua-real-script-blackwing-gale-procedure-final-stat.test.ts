import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const galeCode = "2009101";
const blackwingAllyCode = "20091010";
const nonBlackwingCode = "20091011";
const opponentCode = "20091012";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGaleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${galeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setBlackwing = 0x33;

describe.skipIf(!hasUpstreamScripts || !hasGaleScript)("Lua real script Blackwing Gale procedure final stat", () => {
  it("restores same-set hand Special Summon procedure and target final ATK/DEF halving", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${galeCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("Duel.GetLocationCount(c:GetControler(),LOCATION_MZONE)>0");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,c:GetControler(),LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_BLACKWING) and c:GetCode()~=id");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(tc:GetAttack()/2)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e2:SetValue(tc:GetDefense()/2)");

    const cards = createCards();
    const reader = createCardReader(cards);
    const source = { readScript(name: string) { return workspace.readScript(name) ?? ""; } };

    const noSetAlly = createRestoredGaleWindow({ reader, source, workspace, fieldCase: "noSetAlly" });
    expectCleanRestore(noSetAlly);
    expectRestoredLegalActions(noSetAlly, 0);
    expect(getLuaRestoreLegalActions(noSetAlly, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const faceDownAlly = createRestoredGaleWindow({ reader, source, workspace, fieldCase: "faceDownAlly" });
    expectCleanRestore(faceDownAlly);
    expectRestoredLegalActions(faceDownAlly, 0);
    expect(getLuaRestoreLegalActions(faceDownAlly, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const restoredProcedure = createRestoredGaleWindow({ reader, source, workspace, fieldCase: "valid" });
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const gale = requireCard(restoredProcedure.session, galeCode);
    const procedure = getLuaRestoreLegalActions(restoredProcedure, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === gale.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    expect(procedure).toMatchObject({ windowKind: "open", label: "Special Summon Blackwing - Gale the Whirlwind" });
    applyRestoredActionAndAssert(restoredProcedure, procedure!);
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === gale.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restoredProcedure.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: gale.uid,
        eventPreviousState: { location: "hand", controller: 0, sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { location: "monsterZone", controller: 0, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
      },
    ]);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredProcedure.session), source, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const activate = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === gale.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, activate!);
    resolveRestoredChain(restoredIgnition);

    const opponent = requireCard(restoredIgnition.session, opponentCode);
    expect(currentAttack(opponent, restoredIgnition.session.state)).toBe(1300);
    expect(currentDefense(opponent, restoredIgnition.session.state)).toBe(1000);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === opponent.uid && [102, 106].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, reset: { flags: 33427456 }, value: 1300 },
      { code: 106, reset: { flags: 33427456 }, value: 1000 },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), source, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === gale.uid && action.targetUid === opponent.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyAndAssert(restoredBattle.session, attack!);
    passBattleResponses(restoredBattle.session);
    expect(restoredBattle.session.state.battleDamage[1]).toBe(400);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(7600);
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: gale.uid,
        eventPlayer: 1,
        eventValue: 400,
        eventReason: duelReason.battle,
        eventReasonCardUid: gale.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
  });
});

type GaleFieldCase = "valid" | "noSetAlly" | "faceDownAlly";

function createRestoredGaleWindow({
  reader,
  source,
  workspace,
  fieldCase,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  fieldCase: GaleFieldCase;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 2009101 + fieldCase.length, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [galeCode, blackwingAllyCode, nonBlackwingCode] }, 1: { main: [opponentCode] } });
  startDuel(session);

  const gale = requireCard(session, galeCode);
  const blackwingAlly = requireCard(session, blackwingAllyCode);
  const nonBlackwing = requireCard(session, nonBlackwingCode);
  const opponent = requireCard(session, opponentCode);
  moveDuelCard(session.state, gale.uid, "hand", 0);
  if (fieldCase === "noSetAlly") {
    moveFaceUpAttack(session, nonBlackwing, 0);
  } else {
    const ally = moveFaceUpAttack(session, blackwingAlly, 0);
    if (fieldCase === "faceDownAlly") {
      ally.faceUp = false;
      ally.position = "faceDownDefense";
    }
  }
  moveFaceUpAttack(session, opponent, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(galeCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createCards(): DuelCardData[] {
  return [
    { code: galeCode, name: "Blackwing - Gale the Whirlwind", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBlackwing], level: 3, attack: 1700, defense: 400 },
    { code: blackwingAllyCode, name: "Blackwing Gale Procedure Ally", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBlackwing], level: 4, attack: 1500, defense: 1000 },
    { code: nonBlackwingCode, name: "Gale Non-Blackwing Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000 },
    { code: opponentCode, name: "Gale Final Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2600, defense: 2000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
