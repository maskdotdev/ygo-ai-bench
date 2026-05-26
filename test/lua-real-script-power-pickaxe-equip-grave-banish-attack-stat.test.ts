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
const pickaxeCode = "90246973";
const equippedCode = "902469730";
const opponentGraveCode = "902469731";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPickaxeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pickaxeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPickaxeScript)("Lua real script Power Pickaxe equip grave banish attack stat", () => {
  it("restores equipped grave target banish into equipped monster ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${pickaxeCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredPickaxeField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const pickaxe = requireCard(restored.session, pickaxeCode);
    const equipped = requireCard(restored.session, equippedCode);
    const opponentGrave = requireCard(restored.session, opponentGraveCode);
    expect(restored.session.state.cards.find((card) => card.uid === pickaxe.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: equipped.uid,
      cardTargetUids: [equipped.uid],
      faceUp: true,
    });

    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === pickaxe.uid && candidate.effectId === "lua-3"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === opponentGrave.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: pickaxe.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === equipped.uid), restored.session.state)).toBe(2500);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === equipped.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: equipped.uid, value: 500 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "becameTarget" || event.eventName === "banished").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: opponentGrave.uid, eventCode: 1028, eventName: "becameTarget", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: opponentGrave.uid, eventCode: 1011, eventName: "banished", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: pickaxe.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredPickaxeField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 90246973, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [pickaxeCode, equippedCode] }, 1: { main: [opponentGraveCode] } });
  startDuel(session);
  const equipped = moveFaceUpAttack(session, requireCard(session, equippedCode), 0, 0);
  moveFaceUpEquip(session, requireCard(session, pickaxeCode), 0, equipped.uid);
  const opponentGrave = moveDuelCard(session.state, requireCard(session, opponentGraveCode).uid, "graveyard", 1);
  opponentGrave.faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(pickaxeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Power Pickaxe");
  expect(script).toContain("aux.AddEquipProcedure(c)");
  expect(script).toContain("CATEGORY_REMOVE+CATEGORY_ATKCHANGE");
  expect(script).toContain("EFFECT_FLAG_CARD_TARGET");
  expect(script).toContain("e3:SetRange(LOCATION_SZONE)");
  expect(script).toContain("return c:IsLevelBelow(lv) and c:IsAbleToRemove() and aux.SpElimFilter(c,true)");
  expect(script).toContain("Duel.SelectTarget(tp,s.rmfilter,tp,0,LOCATION_MZONE|LOCATION_GRAVE,1,1,nil,ec:GetLevel())");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,1,0,0)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("EFFECT_UPDATE_ATTACK");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("ec:RegisterEffect(e1)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const pickaxe = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === pickaxeCode);
  expect(pickaxe).toBeDefined();
  return [
    pickaxe!,
    { code: equippedCode, name: "Power Pickaxe Equipped Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
    { code: opponentGraveCode, name: "Power Pickaxe Opponent Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 3, attack: 1200, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpEquip(session: DuelSession, card: DuelCardInstance, player: PlayerId, equippedToUid: string): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.equippedToUid = equippedToUid;
  moved.cardTargetUids = [equippedToUid];
  moved.sequence = 0;
  return moved;
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
