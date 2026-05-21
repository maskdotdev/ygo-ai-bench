import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hundredCode = "90788081";
const allyCode = "907880810";
const extraTargetCode = "907880811";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHundredScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hundredCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;

describe.skipIf(!hasUpstreamScripts || !hasHundredScript)("Lua real script Hundred Dragon level attack grave protect", () => {
  it("restores field-count Level/ATK ignition and TO_GRAVE Extra Deck summon indestructible-count grant", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${hundredCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 90788081, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hundredCode, allyCode], extra: [extraTargetCode] }, 1: { main: [] } });
    startDuel(session);

    const hundred = requireCard(session, hundredCode);
    const ally = requireCard(session, allyCode);
    const extraTarget = requireCard(session, extraTargetCode);
    moveFaceUpAttack(session, hundred, 0);
    moveFaceUpAttack(session, ally, 0);
    moveFaceUpAttack(session, extraTarget, 0);
    extraTarget.summonType = "fusion";
    extraTarget.summonPlayer = 0;
    extraTarget.previousLocation = "extraDeck";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hundredCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const ignition = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === hundred.uid && action.effectId === "lua-1");
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, ignition!);
    passRestoredChain(restoredOpen);

    expect(currentLevel(restoredOpen.session.state.cards.find((card) => card.uid === hundred.uid), restoredOpen.session.state)).toBe(7);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === hundred.uid), restoredOpen.session.state)).toBe(2100);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === hundred.uid)).toMatchObject({
      attackModifier: 300,
      levelModifier: 3,
    });

    const restoredGraveTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredGraveTrigger);
    moveDuelCard(restoredGraveTrigger.session.state, hundred.uid, "graveyard", 0, duelReason.effect, 0);
    const raised = restoredGraveTrigger.host.loadScript(
      `
        local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${hundredCode}),0,LOCATION_GRAVE,0,1,1,nil):GetFirst()
        Duel.RaiseEvent(c,EVENT_TO_GRAVE,nil,REASON_EFFECT,0,0,0)
        Debug.Message("hundred dragon to grave raised")
      `,
      "hundred-dragon-to-grave.lua",
    );
    expect(raised.ok, raised.error).toBe(true);
    expect(restoredGraveTrigger.host.messages).toContain("hundred dragon to grave raised");

    const restoredProtectWindow = restoreDuelWithLuaScripts(serializeDuel(restoredGraveTrigger.session), workspace, reader);
    expectCleanRestore(restoredProtectWindow);
    expectRestoredLegalActions(restoredProtectWindow, 0);
    const protect = getLuaRestoreLegalActions(restoredProtectWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === hundred.uid);
    expect(protect, JSON.stringify(getLuaRestoreLegalActions(restoredProtectWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProtectWindow, protect!);
    expect(restoredProtectWindow.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    passRestoredChain(restoredProtectWindow);

    expect(restoredProtectWindow.session.state.effects.filter((effect) => effect.sourceUid === extraTarget.uid && effect.code === 47).map((effect) => ({
      code: effect.code,
      countLimit: effect.countLimit,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: 47, countLimit: 1, property: 0x400 | 0x400000, reset: { flags: 33427456 }, sourceUid: extraTarget.uid },
    ]);
    const firstDestroy = destroyDuelCard(restoredProtectWindow.session.state, extraTarget.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(firstDestroy).toMatchObject({ uid: extraTarget.uid, location: "monsterZone" });
    const secondDestroy = destroyDuelCard(restoredProtectWindow.session.state, extraTarget.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(secondDestroy).toMatchObject({ uid: extraTarget.uid, location: "graveyard", reason: duelReason.effect | duelReason.destroy });
    expect(restoredProtectWindow.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === extraTarget.uid)).toHaveLength(1);
    expect(restoredProtectWindow.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_LVCHANGE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_ONFIELD,0)");
  expect(script).toContain("c:UpdateLevel(count,RESETS_STANDARD_DISABLE|RESET_PHASE|PHASE_END)");
  expect(script).toContain("c:UpdateAttack(count*100,RESETS_STANDARD_DISABLE|RESET_PHASE|PHASE_END)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DISABLE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSummonLocation,LOCATION_EXTRA),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_COUNT)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_NO_TURN_RESET)");
  expect(script).toContain("return (r&REASON_BATTLE+REASON_EFFECT)~=0");
}

function cards(): DuelCardData[] {
  return [
    { code: hundredCode, name: "Hundred Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
    { code: allyCode, name: "Hundred Dragon Field Ally", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: extraTargetCode, name: "Hundred Dragon Extra Deck Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, level: 6, attack: 2200, defense: 1800 },
  ];
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
