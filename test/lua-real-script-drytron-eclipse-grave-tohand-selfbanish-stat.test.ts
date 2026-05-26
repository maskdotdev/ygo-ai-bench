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
const eclipseCode = "21576077";
const graveDrytronCode = "215760770";
const fieldDrytronCode = "215760771";
const decoyCode = "215760772";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasEclipseScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${eclipseCode}.lua`));
const setDrytron = 0x151;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasEclipseScript)("Lua real script Drytron Eclipse grave to-hand self-banish stat", () => {
  it("restores GY Drytron target to hand and grave SelfBanish ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${eclipseCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 21576077, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [eclipseCode, graveDrytronCode, fieldDrytronCode, decoyCode] }, 1: { main: [] } });
    startDuel(session);

    const eclipse = requireCard(session, eclipseCode);
    const graveDrytron = requireCard(session, graveDrytronCode);
    const fieldDrytron = requireCard(session, fieldDrytronCode);
    const decoy = requireCard(session, decoyCode);
    moveDuelCard(session.state, eclipse.uid, "hand", 0);
    moveDuelCard(session.state, graveDrytron.uid, "graveyard", 0);
    moveFaceUpMonster(session, fieldDrytron, 0, 0);
    moveFaceUpMonster(session, decoy, 0, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(eclipseCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredActivate = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredActivate);
    expectRestoredLegalActions(restoredActivate, 0);
    const activate = getLuaRestoreLegalActions(restoredActivate, 0).find((action) =>
      action.type === "activateEffect" && action.uid === eclipse.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivate, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivate, activate!);
    resolveRestoredChain(restoredActivate);

    expect(findCard(restoredActivate.session, graveDrytron.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: eclipse.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restoredActivate.session, eclipse.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reasonPlayer: 0,
    });
    expect(restoredActivate.session.state.eventHistory.filter((event) =>
      ["becameTarget", "sentToHand"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: graveDrytron.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: graveDrytron.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: eclipse.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
    ]);

    findCard(restoredActivate.session, eclipse.uid).turnId = 0;
    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredActivate.session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) =>
      action.type === "activateEffect" && action.uid === eclipse.uid && action.effectId === "lua-2"
    );
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    resolveRestoredChain(restoredIgnition);

    expect(findCard(restoredIgnition.session, eclipse.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: eclipse.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(findCard(restoredIgnition.session, fieldDrytron.uid), restoredIgnition.session.state)).toBe(4000);
    expect(currentAttack(findCard(restoredIgnition.session, decoy.uid), restoredIgnition.session.state)).toBe(900);
    expect(restoredIgnition.session.state.effects.filter((effect) =>
      effect.sourceUid === fieldDrytron.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792, count: 2 }, sourceUid: fieldDrytron.uid, value: 2000 },
    ]);
    expect(restoredIgnition.session.state.eventHistory.filter((event) =>
      event.eventName === "banished" || event.eventCardUid === fieldDrytron.uid
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: eclipse.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: eclipse.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: fieldDrytron.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);
    expect(restoredIgnition.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const eclipse = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === eclipseCode);
  expect(eclipse).toBeDefined();
  return [
    { ...eclipse!, kind: "spell", typeFlags: typeSpell },
    { code: graveDrytronCode, name: "Drytron Eclipse GY Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDrytron], level: 1, attack: 1000, defense: 0 },
    { code: fieldDrytronCode, name: "Drytron Eclipse Field Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDrytron], level: 1, attack: 2000, defense: 0 },
    { code: decoyCode, name: "Drytron Eclipse Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 900 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,g,1,0,LOCATION_GRAVE)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCondition(aux.exccon)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END,2)");
  expect(script).toContain("e1:SetValue(2000)");
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
