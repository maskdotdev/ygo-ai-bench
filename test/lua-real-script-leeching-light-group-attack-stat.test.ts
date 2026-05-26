import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const leechingCode = "90263923";
const firstAttackerCode = "902639230";
const secondAttackerCode = "902639231";
const defenseDecoyCode = "902639232";
const lightTargetCode = "902639233";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasLeechingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${leechingCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeNormal = 0x10;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const attributeLight = 0x10;
const effectUpdateAttack = 100;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasLeechingScript)("Lua real script Leeching the Light group attack stat", () => {
  it("restores opponent LIGHT target ATK into every own attack-position monster boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${leechingCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const leeching = requireCard(restored.session, leechingCode);
    const first = requireCard(restored.session, firstAttackerCode);
    const second = requireCard(restored.session, secondAttackerCode);
    const defenseDecoy = requireCard(restored.session, defenseDecoyCode);
    const lightTarget = requireCard(restored.session, lightTargetCode);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === leeching.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(currentAttack(findCard(restored.session, first.uid), restored.session.state)).toBe(3300);
    expect(currentAttack(findCard(restored.session, second.uid), restored.session.state)).toBe(3000);
    expect(currentAttack(findCard(restored.session, defenseDecoy.uid), restored.session.state)).toBe(900);
    expect(currentAttack(findCard(restored.session, lightTarget.uid), restored.session.state)).toBe(2100);
    expect(restored.session.state.effects.filter((effect) =>
      [first.uid, second.uid, defenseDecoy.uid, lightTarget.uid].includes(effect.sourceUid ?? "") && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: first.uid, value: 2100 },
      { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: second.uid, value: 2100 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCardUid: lightTarget.uid, eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 1, previous: "deck", current: "monsterZone" },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expect(currentAttack(findCard(restoredStat.session, first.uid), restoredStat.session.state)).toBe(3300);
    expect(currentAttack(findCard(restoredStat.session, second.uid), restoredStat.session.state)).toBe(3000);
    expect(currentAttack(findCard(restoredStat.session, defenseDecoy.uid), restoredStat.session.state)).toBe(900);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const leeching = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === leechingCode);
  expect(leeching).toBeDefined();
  return [
    { ...leeching!, kind: "spell", typeFlags: typeSpell },
    { code: firstAttackerCode, name: "Leeching the Light First Attacker", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: secondAttackerCode, name: "Leeching the Light Second Attacker", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 900, defense: 1000 },
    { code: defenseDecoyCode, name: "Leeching the Light Defense Decoy", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 900, defense: 1800 },
    { code: lightTargetCode, name: "Leeching the Light Opponent LIGHT", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2100, defense: 1600 },
  ];
}

function createRestoredField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 90263923, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [leechingCode, firstAttackerCode, secondAttackerCode, defenseDecoyCode] }, 1: { main: [lightTargetCode] } });
  startDuel(session);
  moveFaceDownSpellTrap(session, requireCard(session, leechingCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, firstAttackerCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, secondAttackerCode), 0, 1);
  moveFaceUpDefense(session, requireCard(session, defenseDecoyCode), 0, 2);
  moveFaceUpAttack(session, requireCard(session, lightTargetCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(leechingCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Leeching the Light");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsPosition,tp,LOCATION_MZONE,0,1,nil,POS_FACEUP_ATTACK)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("local tc=Duel.GetFirstTarget()");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsPosition,tp,LOCATION_MZONE,0,nil,POS_FACEUP_ATTACK)");
  expect(script).toContain("local atk=tc:GetAttack()");
  expect(script).toContain("for sc in aux.Next(g) do");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(atk)");
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

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpDefense";
  moved.sequence = sequence;
  return moved;
}

function moveFaceDownSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = false;
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
