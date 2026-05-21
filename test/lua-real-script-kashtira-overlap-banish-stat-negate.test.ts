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
const overlapCode = "8953369";
const targetCode = "89533690";
const banishCostCode = "89533691";
const kashtiraCode = "89533692";
const opponentCode = "89533693";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasOverlapScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${overlapCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const setKashtira = 0x18a;

describe.skipIf(!hasUpstreamScripts || !hasOverlapScript)("Lua real script Kashtira Overlap banish stat negate", () => {
  it("restores target ATK boost banish activation and removed-card monster negate trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${overlapCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 8953369, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [overlapCode, targetCode, banishCostCode, kashtiraCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const overlap = requireCard(session, overlapCode);
    const target = requireCard(session, targetCode);
    const banishCost = requireCard(session, banishCostCode);
    const kashtira = requireCard(session, kashtiraCode);
    const opponent = requireCard(session, opponentCode);
    moveFaceDownTrap(session, overlap);
    moveFaceUpAttack(session, target, 0);
    moveFaceUpAttack(session, kashtira, 0);
    moveFaceUpAttack(session, opponent, 1);
    const graveMaterial = moveDuelCard(session.state, banishCost.uid, "graveyard", 0);
    graveMaterial.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(overlapCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === overlap.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)!, restoredOpen.session.state)).toBe(3300);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === banishCost.uid)).toMatchObject({
      controller: 0,
      faceUp: true,
      location: "banished",
      reason: duelReason.effect,
      reasonCardUid: overlap.uid,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: 100, reset: { flags: 33427456 }, sourceUid: target.uid, value: 1500 }]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget" || event.eventName === "banished").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: target.uid, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonPlayer: 0 },
      { eventCardUid: banishCost.uid, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: overlap.uid, eventReasonPlayer: 0 },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredSelfBanish = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSelfBanish);
    const banishOverlap = restoredSelfBanish.host.loadScript(
      `
        local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${overlapCode}),0,LOCATION_GRAVE,0,1,1,nil):GetFirst()
        Debug.Message("kashtira overlap self banish " .. Duel.Remove(c,POS_FACEUP,REASON_EFFECT))
      `,
      "kashtira-overlap-self-banish.lua",
    );
    expect(banishOverlap.ok, banishOverlap.error).toBe(true);
    expect(restoredSelfBanish.host.messages).toContain("kashtira overlap self banish 1");

    const restoredNegateWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSelfBanish.session), workspace, reader);
    expectCleanRestore(restoredNegateWindow);
    expectRestoredLegalActions(restoredNegateWindow, 0);
    const negate = getLuaRestoreLegalActions(restoredNegateWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === overlap.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredNegateWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredNegateWindow, negate!);
    expect(restoredNegateWindow.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    passRestoredChain(restoredNegateWindow);

    expect(restoredNegateWindow.session.state.effects.filter((effect) => effect.sourceUid === opponent.uid && (effect.code === 2 || effect.code === 8)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: 2, property: 0x400, reset: { flags: 1107169792 }, sourceUid: opponent.uid },
      { code: 8, property: 0x400, reset: { flags: 1107169792 }, sourceUid: opponent.uid },
    ]);
    expectLuaOpponentProbe(restoredNegateWindow, opponentCode, `kashtira overlap probe ${opponentCode}/true`);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_REMOVE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,tc,1,0,1500)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,nil,1,PLAYER_EITHER,LOCATION_HAND|LOCATION_GRAVE|LOCATION_MZONE)");
  expect(script).toContain("Duel.Remove(rg,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EVENT_REMOVE)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_KASHTIRA),tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.disfilter,tp,0,LOCATION_MZONE,1,1,nil):GetFirst()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,tc,1,0,0)");
  expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: overlapCode, name: "Kashtira Overlap", kind: "trap", typeFlags: typeTrap },
    { code: targetCode, name: "Kashtira Overlap Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
    { code: banishCostCode, name: "Kashtira Overlap Banish Material", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 2100 },
    { code: kashtiraCode, name: "Kashtira Overlap Kashtira Ally", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setKashtira], level: 4, attack: 1600, defense: 1200 },
    { code: opponentCode, name: "Kashtira Overlap Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceDownTrap(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
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

function expectLuaOpponentProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local tc=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),1,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("kashtira overlap probe " .. tc:GetCode() .. "/" .. tostring(tc:IsDisabled()))
    `,
    "kashtira-overlap-disable-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
