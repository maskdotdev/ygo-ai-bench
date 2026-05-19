import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLeftScale, currentRightScale } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const mildTurkeyCode = "47558785";
const highScaleCode = "475587850";
const pendulumType = 0x1000001;
const effectUpdateLeftScale = 134;
const effectUpdateRightScale = 136;
const resetsStandardDisablePhaseEnd = 0x41ff1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mild Turkey dice scale update", () => {
  it("restores a Pendulum-zone dice roll into temporary left and right scale reductions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${mildTurkeyCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DICE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DICE,nil,0,tp,1)");
    expect(script).toContain("local dc=Duel.TossDice(tp,1)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_LSCALE)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_RSCALE)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mildTurkeyCode),
      { code: highScaleCode, name: "Mild Turkey High Scale Fixture", kind: "monster", typeFlags: pendulumType, level: 4, leftScale: 8, rightScale: 8 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 47558785, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mildTurkeyCode, highScaleCode] }, 1: { main: [] } });
    startDuel(session);

    const mildTurkey = requireCard(session, mildTurkeyCode);
    const highScale = requireCard(session, highScaleCode);
    moveDuelCard(session.state, mildTurkey.uid, "spellTrapZone", 0);
    mildTurkey.sequence = 0;
    mildTurkey.faceUp = true;
    moveDuelCard(session.state, highScale.uid, "spellTrapZone", 0);
    highScale.sequence = 1;
    highScale.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    expect(currentLeftScale(mildTurkey, session.state)).toBe(7);
    expect(currentRightScale(mildTurkey, session.state)).toBe(7);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mildTurkeyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find(
      (action): action is Extract<DuelAction, { type: "activateEffect" }> => action.type === "activateEffect" && action.uid === mildTurkey.uid,
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    expect(activation).toMatchObject({
      type: "activateEffect",
      uid: mildTurkey.uid,
    });
    const activationEffectNumber = Number(activation!.effectId.replace(/^lua-/, ""));
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain).toHaveLength(0);
    expect(restoredActivation.session.state.randomCounter).toBe(1);
    expect(restoredActivation.session.state.lastDiceResults).toHaveLength(1);
    const [die] = restoredActivation.session.state.lastDiceResults;
    expect(die).toBe(4);
    const scaleReduction = Math.min(6, die!);
    expect(currentLeftScale(restoredActivation.session.state.cards.find((card) => card.uid === mildTurkey.uid), restoredActivation.session.state)).toBe(7 - scaleReduction);
    expect(currentRightScale(restoredActivation.session.state.cards.find((card) => card.uid === mildTurkey.uid), restoredActivation.session.state)).toBe(7 - scaleReduction);
    expect(restoredActivation.session.state.eventHistory.filter((event) => event.eventName === "diceTossed")).toEqual([
      {
        eventName: "diceTossed",
        eventCode: 1150,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonCardUid: mildTurkey.uid,
        eventReasonEffectId: activationEffectNumber,
        eventReasonPlayer: 0,
      },
    ]);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.sourceUid === mildTurkey.uid && [effectUpdateLeftScale, effectUpdateRightScale].includes(effect.code ?? -1))).toEqual([
      expect.objectContaining({ event: "continuous", code: effectUpdateLeftScale, value: -scaleReduction, reset: { flags: resetsStandardDisablePhaseEnd } }),
      expect.objectContaining({ event: "continuous", code: effectUpdateRightScale, value: -scaleReduction, reset: { flags: resetsStandardDisablePhaseEnd } }),
    ]);

    const restoredScale = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expectCleanRestore(restoredScale);
    expectRestoredLegalActions(restoredScale, 0);
    expect(currentLeftScale(restoredScale.session.state.cards.find((card) => card.uid === mildTurkey.uid), restoredScale.session.state)).toBe(7 - scaleReduction);
    expect(currentRightScale(restoredScale.session.state.cards.find((card) => card.uid === mildTurkey.uid), restoredScale.session.state)).toBe(7 - scaleReduction);
    expect(restoredScale.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
