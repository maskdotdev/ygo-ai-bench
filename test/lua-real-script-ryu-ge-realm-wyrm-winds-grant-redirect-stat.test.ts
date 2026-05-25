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
const realmCode = "55154344";
const costSpellCode = "551543440";
const grantedMonsterCode = "551543441";
const opponentTargetCode = "551543442";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRealmScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${realmCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const typePendulum = 0x1000000;
const setRyuGe = 0x1b8;
const raceWyrm = 0x800000;
const attributeWind = 0x8;
const effectToGraveRedirect = 63;
const effectSetAttackFinal = 102;
const effectAddType = 115;

describe.skipIf(!hasUpstreamScripts || !hasRealmScript)("Lua real script Ryu-Ge Realm Wyrm Winds grant redirect stat", () => {
  it("restores opponent-turn redirect and granted Quick Effect cost into final ATK zero", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${realmCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createRyuGeSession(reader, workspace);
    const realm = requireCard(session, realmCode);
    const grantedMonster = requireCard(session, grantedMonsterCode);
    const opponentTarget = requireCard(session, opponentTargetCode);

    moveFaceUpSpell(session, realm, 0, 0);
    moveFaceUpSpell(session, requireCard(session, costSpellCode), 0, 1);
    moveFaceUpAttack(session, grantedMonster, 0, 0);
    moveFaceUpAttack(session, opponentTarget, 1, 0);
    session.state.turnPlayer = 1;
    session.state.waitingFor = 0;
    session.state.phase = "main1";

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === realm.uid && [effectToGraveRedirect, effectAddType].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectToGraveRedirect, event: "continuous", property: 0x180, range: ["spellTrapZone"], targetRange: [0x04, 0x04], value: 0x20 },
      { code: effectAddType, event: "continuous", property: undefined, range: ["spellTrapZone"], targetRange: [0x04, 0], value: typeEffect },
    ]);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredOpen.session.state)).toBe(2400);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const grantedAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === grantedMonster.uid
    );
    expect(grantedAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, grantedAction!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === realm.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: grantedMonster.uid,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredOpen.session.state)).toBe(0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === opponentTarget.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: 0x400, reset: { flags: 33427456 }, sourceUid: opponentTarget.uid, value: 0 },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredResolved.session.state)).toBe(0);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Ryu-Ge Realm - Wyrm Winds");
  expect(script).toContain("c:SetUniqueOnField(1,0,id)");
  expect(script).toContain("e1:SetCode(EFFECT_TO_GRAVE_REDIRECT)");
  expect(script).toContain("Duel.IsTurnPlayer(1-e:GetHandlerPlayer())");
  expect(script).toContain("Duel.IsPlayerCanRemove(e:GetHandlerPlayer(),c)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_GRANT)");
  expect(script).toContain("e3:SetLabelObject(e2)");
  expect(script).toContain("e4:SetCode(EFFECT_ADD_TYPE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_ONFIELD,0,1,1,nil)");
  expect(script).toContain("Duel.HintSelection(g)");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKBOTTOM,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.HasNonZeroAttack,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
}

function cards(): DuelCardData[] {
  return [
    { code: realmCode, name: "Ryu-Ge Realm - Wyrm Winds", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setRyuGe] },
    { code: costSpellCode, name: "Ryu-Ge Continuous Cost", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setRyuGe] },
    { code: grantedMonsterCode, name: "Ryu-Ge Granted Pendulum", kind: "monster", typeFlags: typeMonster | typePendulum, setcodes: [setRyuGe], race: raceWyrm, attribute: attributeWind, level: 4, attack: 0, defense: 1200, leftScale: 1, rightScale: 1 },
    { code: opponentTargetCode, name: "Ryu-Ge Opponent Attack Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWyrm, attribute: attributeWind, level: 4, attack: 2400, defense: 1600 },
  ];
}

function createRyuGeSession(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelSession {
  const session = createDuel({ seed: 55154344, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [realmCode, costSpellCode, grantedMonsterCode], extra: [] }, 1: { main: [opponentTargetCode], extra: [] } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(realmCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
