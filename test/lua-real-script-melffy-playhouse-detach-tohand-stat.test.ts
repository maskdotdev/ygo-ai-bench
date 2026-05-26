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
const playhouseCode = "82134632";
const beastXyzACode = "821346320";
const beastXyzBCode = "821346321";
const overlayMaterialCode = "821346322";
const opponentTargetCode = "821346323";
const opponentDecoyCode = "821346324";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPlayhouseScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${playhouseCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceBeast = 0x4000;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPlayhouseScript)("Lua real script Melffy Playhouse detach to-hand stat", () => {
  it("detaches Beast Xyz material, returns opponent card, and boosts all face-up Beast Xyz monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${playhouseCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 82134632, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [playhouseCode, overlayMaterialCode], extra: [beastXyzACode, beastXyzBCode] }, 1: { main: [opponentTargetCode, opponentDecoyCode] } });
    startDuel(session);

    const playhouse = requireCard(session, playhouseCode);
    const beastXyzA = requireCard(session, beastXyzACode);
    const beastXyzB = requireCard(session, beastXyzBCode);
    const material = requireCard(session, overlayMaterialCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const opponentDecoy = requireCard(session, opponentDecoyCode);
    setFaceDownTrap(session, playhouse, 0, 0);
    moveFaceUpMonster(session, beastXyzA, 0, 0);
    moveFaceUpMonster(session, beastXyzB, 0, 1);
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = 0;
    beastXyzA.overlayUids.push(material.uid);
    moveFaceUpMonster(session, opponentTarget, 1, 0);
    moveFaceUpMonster(session, opponentDecoy, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(playhouseCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === playhouse.uid && candidate.effectId === "lua-1-1002"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, beastXyzA.uid).overlayUids).toEqual([]);
    expect(findCard(restored.session, material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: playhouse.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restored.session, opponentTarget.uid)).toMatchObject({
      location: "hand",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: playhouse.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restored.session, opponentDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(currentAttack(findCard(restored.session, beastXyzA.uid), restored.session.state)).toBe(1500);
    expect(currentAttack(findCard(restored.session, beastXyzB.uid), restored.session.state)).toBe(1700);
    expect(restored.session.state.effects.filter((effect) =>
      [beastXyzA.uid, beastXyzB.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 1107169792 }, sourceUid: beastXyzA.uid, value: 500 },
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 1107169792 }, sourceUid: beastXyzB.uid, value: 500 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) =>
      ["detachedMaterial", "becameTarget", "sentToHand"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: material.uid, eventCode: 1202, eventName: "detachedMaterial", eventReason: duelReason.cost, eventReasonCardUid: playhouse.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: opponentTarget.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: opponentTarget.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: playhouse.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const playhouse = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === playhouseCode);
  expect(playhouse).toBeDefined();
  return [
    { ...playhouse!, kind: "trap", typeFlags: typeTrap },
    { code: beastXyzACode, name: "Melffy Playhouse Beast Xyz A", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceBeast, level: 2, attack: 1000, defense: 1000 },
    { code: beastXyzBCode, name: "Melffy Playhouse Beast Xyz B", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceBeast, level: 2, attack: 1200, defense: 1000 },
    { code: overlayMaterialCode, name: "Melffy Playhouse Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, level: 2, attack: 400, defense: 400 },
    { code: opponentTargetCode, name: "Melffy Playhouse Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1200 },
    { code: opponentDecoyCode, name: "Melffy Playhouse Opponent Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Melffy Playhouse");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.CheckRemoveOverlayCard(tp,0,0,1,REASON_COST,xyzg)");
  expect(script).toContain("local xyz_max_ct=xyzg:GetSum(Card.GetOverlayCount)");
  expect(script).toContain("Duel.RemoveOverlayCard(tp,0,0,1,xyz_max_ct,REASON_COST,xyzg)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToHand,tp,0,LOCATION_ONFIELD,1,detach_ct,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,g,#g,tp,0)");
  expect(script).toContain("Duel.SendtoHand(tg,nil,REASON_EFFECT)");
  expect(script).toContain("local atk=e:GetLabel()*500");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(atk)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
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

function setFaceDownTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = false;
  moved.position = "faceDown";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
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
