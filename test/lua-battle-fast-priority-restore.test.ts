import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import {
  activateTurnQuick,
  applyAndAssert,
  applyLuaRestoreAndAssert,
  assertLuaRestoreLegalWindow,
  hasGroupedLuaEffect,
  hasGroupedPass,
  passBattleResponse,
  setupRestoredBattleQuick,
} from "./lua-battle-fast-priority-helpers.js";

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function advanceToEndDamageStep(session: ReturnType<typeof createDuel>): void {
  for (let count = 0; count < 20; count += 1) {
    if (session.state.battleWindow?.kind === "endDamageStep" && session.state.battleWindow.responsePlayer === 1) return;
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passDamage");
    if (!pass) break;
    applyAndAssert(session, pass);
  }
}

describe("Lua battle fast priority restore", () => {
  it("restores live damage-step fast chains back to the battle response player", () => {
    const fixture = setupRestoredBattleQuick("EFFECT_FLAG_DAMAGE_STEP");
    passBattleResponse(fixture.session, 1, "passDamage");
    expect(fixture.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "startDamageStep", responsePlayer: 0 } });

    const quick = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(quick).toMatchObject({ player: 0, windowKind: "battle" });
    const quickResult = applyAndAssert(fixture.session, quick!);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", damagePasses: [], battleWindow: { kind: "startDamageStep", responsePlayer: 0 } });
    const originalPass = getDuelLegalActions(fixture.session, 1).find((candidate) => candidate.type === "passChain");
    expect(originalPass).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 1, windowKind: "chainResponse", uid: expect.stringContaining("400") })]));
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid.includes("500"))).toBe(false);
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 1), 1, "400", "chainResponse")).toBe(true);
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 1), 1, "500", "chainResponse")).toBe(false);

    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expect(hasGroupedPass(getLuaRestoreLegalActionGroups(restored, 1), 1)).toBe(true);
    const opponentBattleQuick = restored.session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "500");
    expect(opponentBattleQuick).toBeDefined();
    const opponentBattleQuickEffect = restored.session.state.effects.find((effect) => effect.sourceUid === opponentBattleQuick!.uid);
    expect(opponentBattleQuickEffect).toBeDefined();
    expect(pass!.windowId).toBeDefined();
    expect(pass!.windowKind).toBeDefined();
    expect(pass!.windowToken).toBeDefined();
    const forgedBattleQuick = applyLuaRestoreResponse(restored, {
      type: "activateEffect",
      player: 1,
      uid: opponentBattleQuick!.uid,
      effectId: opponentBattleQuickEffect!.id,
      label: "Forge battle-only quick into chain response",
      windowId: pass!.windowId!,
      windowKind: pass!.windowKind!,
      windowToken: pass!.windowToken!,
    });
    expect(forgedBattleQuick.ok).toBe(false);
    expect(forgedBattleQuick.error).toContain("Response is not currently legal");
    expect(forgedBattleQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(forgedBattleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(restored.host.messages).toEqual([]);
    const staleBeforePass = applyLuaRestoreResponse(restored, { ...pass!, windowId: pass!.windowId! - 1 });
    expect(staleBeforePass.ok).toBe(false);
    expect(staleBeforePass.error).toContain("Response is not currently legal");
    expect(staleBeforePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforePass.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleBeforePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleBeforePass, staleBeforePass.state.waitingFor!);
    const originalPassPreapply = applyLuaRestoreResponse(restored, originalPass!);
    expect(originalPassPreapply.ok).toBe(false);
    expect(originalPassPreapply.error).toContain("Response is not currently legal");
    expect(originalPassPreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(restored.host.messages).toEqual([]);

    const resolved = applyLuaRestoreAndAssert(restored, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleWindow: { kind: "startDamageStep", responsePlayer: 1 } });
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(resolved.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);
    expect(resolved.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 1, windowKind: "battle", uid: expect.stringContaining("500") })]));
    expect(hasGroupedLuaEffect(resolved.legalActionGroups, 1, "500", "battle")).toBe(true);
    expect(getDuelLegalActions(restored.session, 0)).toEqual([]);
    const opponentChainQuick = restored.session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(opponentChainQuick).toBeDefined();
    const opponentChainQuickEffect = restored.session.state.effects.find((effect) => effect.sourceUid === opponentChainQuick!.uid);
    expect(opponentChainQuickEffect).toBeDefined();
    const currentBattleAction = resolved.legalActions[0];
    expect(currentBattleAction).toBeDefined();
    expect(currentBattleAction!.windowId).toBeDefined();
    expect(currentBattleAction!.windowKind).toBeDefined();
    expect(currentBattleAction!.windowToken).toBeDefined();
    const forgedChainOnlyQuick = applyLuaRestoreResponse(restored, {
      type: "activateEffect",
      player: 1,
      uid: opponentChainQuick!.uid,
      effectId: opponentChainQuickEffect!.id,
      label: "Forge chain-only quick into battle window",
      windowId: currentBattleAction!.windowId!,
      windowKind: currentBattleAction!.windowKind!,
      windowToken: currentBattleAction!.windowToken!,
    });
    expect(forgedChainOnlyQuick.ok).toBe(false);
    expect(forgedChainOnlyQuick.error).toContain("Response is not currently legal");
    expect(forgedChainOnlyQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(forgedChainOnlyQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(restored.host.messages).toEqual(["restored battle quick resolved"]);
    const restoredBattleWindow = restoreDuelWithLuaScripts(serializeDuel(restored.session), fixture.source, createCardReader(fixture.cards));
    expect(restoredBattleWindow.restoreComplete, restoredBattleWindow.incompleteReasons.join("; ")).toBe(true);
    expect(queryPublicState(restoredBattleWindow.session)).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "startDamageStep", responsePlayer: 1 } });
    expect(getLuaRestoreLegalActions(restoredBattleWindow, 0)).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredBattleWindow, 1)).toEqual(getDuelLegalActions(restoredBattleWindow.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredBattleWindow, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredBattleWindow, 1));
    const restoredBattleAction = getLuaRestoreLegalActions(restoredBattleWindow, 1)[0];
    expect(restoredBattleAction).toBeDefined();
    expect(restoredBattleAction!.windowId).toBeDefined();
    expect(restoredBattleAction!.windowKind).toBeDefined();
    expect(restoredBattleAction!.windowToken).toBeDefined();
    const restoredOpponentChainQuick = restoredBattleWindow.session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(restoredOpponentChainQuick).toBeDefined();
    const restoredOpponentChainQuickEffect = restoredBattleWindow.session.state.effects.find((effect) => effect.sourceUid === restoredOpponentChainQuick!.uid);
    expect(restoredOpponentChainQuickEffect).toBeDefined();
    const forgedRestoredBattleChainOnly = applyLuaRestoreResponse(restoredBattleWindow, {
      type: "activateEffect",
      player: 1,
      uid: restoredOpponentChainQuick!.uid,
      effectId: restoredOpponentChainQuickEffect!.id,
      label: "Forge chain-only quick into restored battle window",
      windowId: restoredBattleAction!.windowId!,
      windowKind: restoredBattleAction!.windowKind!,
      windowToken: restoredBattleAction!.windowToken!,
    });
    expect(forgedRestoredBattleChainOnly.ok).toBe(false);
    expect(forgedRestoredBattleChainOnly.error).toContain("Response is not currently legal");
    expect(forgedRestoredBattleChainOnly.legalActions).toEqual(getDuelLegalActions(restoredBattleWindow.session, 1));
    expect(forgedRestoredBattleChainOnly.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredBattleWindow.session, 1));
    expect(restoredBattleWindow.host.messages).toEqual([]);
    const stalePass = applyLuaRestoreResponse(restored, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, stalePass, stalePass.state.waitingFor!);
    expect(restored.host.messages).toEqual(["restored battle quick resolved"]);
  });

  it("returns restored damage-step quick chains to the damage response player", () => {
    const fixture = setupRestoredBattleQuick("EFFECT_FLAG_DAMAGE_STEP");
    passBattleResponse(fixture.session, 1, "passDamage");
    activateTurnQuick(fixture);

    const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 1, windowKind: "chainResponse", uid: expect.stringContaining("400") })]));
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid.includes("500"))).toBe(false);
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 1), 1, "400", "chainResponse")).toBe(true);
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 1), 1, "500", "chainResponse")).toBe(false);
    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expect(hasGroupedPass(getLuaRestoreLegalActionGroups(restored, 1), 1)).toBe(true);

    const result = applyLuaRestoreAndAssert(restored, pass!);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleStep: "damage", battleWindow: { kind: "startDamageStep", responsePlayer: 1 } });
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 1, windowKind: "battle", uid: expect.stringContaining("500") })]));
    expect(hasGroupedLuaEffect(result.legalActionGroups, 1, "500", "battle")).toBe(true);
    expect(getDuelLegalActions(restored.session, 0)).toEqual([]);

    const stalePass = applyLuaRestoreResponse(restored, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, stalePass, stalePass.state.waitingFor!);
    expect(restored.host.messages).toEqual(["restored battle quick resolved"]);
  });

  it("returns restored damage-calculation quick chains to the damage-calculation response player", () => {
    const fixture = setupRestoredBattleQuick("EFFECT_FLAG_DAMAGE_CAL");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    expect(fixture.session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    passBattleResponse(fixture.session, 1, "passDamage");
    activateTurnQuick(fixture);

    const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 1, windowKind: "chainResponse", uid: expect.stringContaining("400") })]));
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid.includes("500"))).toBe(false);
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 1), 1, "400", "chainResponse")).toBe(true);
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 1), 1, "500", "chainResponse")).toBe(false);
    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expect(hasGroupedPass(getLuaRestoreLegalActionGroups(restored, 1), 1)).toBe(true);

    const result = applyLuaRestoreAndAssert(restored, pass!);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleStep: "damageCalculation", battleWindow: { kind: "duringDamageCalculation", responsePlayer: 1 } });
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 1, windowKind: "battle", uid: expect.stringContaining("500") })]));
    expect(hasGroupedLuaEffect(result.legalActionGroups, 1, "500", "battle")).toBe(true);
    expect(getDuelLegalActions(restored.session, 0)).toEqual([]);

    const stalePass = applyLuaRestoreResponse(restored, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, stalePass, stalePass.state.waitingFor!);
    expect(restored.host.messages).toEqual(["restored battle quick resolved"]);
  });

  it("resets restored damage-step passes after a Lua quick effect resolves", () => {
    const fixture = setupRestoredBattleQuick("EFFECT_FLAG_DAMAGE_STEP");
    passBattleResponse(fixture.session, 1, "passDamage");
    expect(fixture.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "startDamageStep", responsePlayer: 0 } });
    const originalQuick = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(originalQuick).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "startDamageStep", responsePlayer: 0 } });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const quick = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect");
    expect(quick).toMatchObject({ player: 0, windowKind: "battle" });

    const staleBeforeQuick = applyLuaRestoreResponse(restored, { ...quick!, windowId: quick!.windowId! - 1 });
    expect(staleBeforeQuick.ok).toBe(false);
    expect(staleBeforeQuick.error).toContain("Response is not currently legal");
    expect(staleBeforeQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleBeforeQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleBeforeQuick, staleBeforeQuick.state.waitingFor!);
    const originalQuickPreapply = applyLuaRestoreResponse(restored, originalQuick!);
    expect(originalQuickPreapply.ok).toBe(false);
    expect(originalQuickPreapply.error).toContain("Response is not currently legal");
    expect(originalQuickPreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(restored.session.state.damagePasses).toEqual([1]);
    expect(restored.host.messages).toEqual([]);

    const result = applyLuaRestoreAndAssert(restored, quick!);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", damagePasses: [], battleWindow: { kind: "startDamageStep", responsePlayer: 0 } });
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passChain", player: 1, windowKind: "chainResponse" })]));
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 1, windowKind: "chainResponse", uid: expect.stringContaining("400") })]));
    expect(result.legalActions.some((action) => action.type === "activateEffect" && action.uid.includes("500"))).toBe(false);
    expect(getDuelLegalActions(restored.session, 0)).toEqual([]);

    const staleQuick = applyLuaRestoreResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleQuick, staleQuick.state.waitingFor!);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreAndAssert(restored, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleWindow: { kind: "startDamageStep", responsePlayer: 1 } });
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(resolved.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);
    expect(resolved.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(resolved.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 1, windowKind: "battle", uid: expect.stringContaining("500") })]));

    const stalePass = applyLuaRestoreResponse(restored, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, stalePass, stalePass.state.waitingFor!);
    expect(restored.host.messages).toEqual(["restored battle quick resolved"]);
  });

  it("resets restored damage-calculation passes after a Lua quick effect resolves", () => {
    const fixture = setupRestoredBattleQuick("EFFECT_FLAG_DAMAGE_CAL");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    expect(fixture.session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    passBattleResponse(fixture.session, 1, "passDamage");
    expect(fixture.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleStep: "damageCalculation", battleWindow: { kind: "duringDamageCalculation", responsePlayer: 0 } });

    const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleStep: "damageCalculation", battleWindow: { kind: "duringDamageCalculation", responsePlayer: 0 } });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const quick = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect");
    expect(quick).toMatchObject({ player: 0, windowKind: "battle" });

    const staleBeforeQuick = applyLuaRestoreResponse(restored, { ...quick!, windowId: quick!.windowId! - 1 });
    expect(staleBeforeQuick.ok).toBe(false);
    expect(staleBeforeQuick.error).toContain("Response is not currently legal");
    expect(staleBeforeQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleBeforeQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleBeforeQuick, staleBeforeQuick.state.waitingFor!);
    expect(restored.session.state.damagePasses).toEqual([1]);
    expect(restored.host.messages).toEqual([]);

    const result = applyLuaRestoreAndAssert(restored, quick!);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", damagePasses: [], battleWindow: { kind: "duringDamageCalculation", responsePlayer: 0 } });
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passChain", player: 1, windowKind: "chainResponse" })]));
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 1, windowKind: "chainResponse", uid: expect.stringContaining("400") })]));
    expect(result.legalActions.some((action) => action.type === "activateEffect" && action.uid.includes("500"))).toBe(false);
    expect(getDuelLegalActions(restored.session, 0)).toEqual([]);

    const staleQuick = applyLuaRestoreResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleQuick, staleQuick.state.waitingFor!);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreAndAssert(restored, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleStep: "damageCalculation", battleWindow: { kind: "duringDamageCalculation", responsePlayer: 1 } });
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(resolved.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);
    expect(resolved.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(resolved.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 1, windowKind: "battle", uid: expect.stringContaining("500") })]));

    const stalePass = applyLuaRestoreResponse(restored, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, stalePass, stalePass.state.waitingFor!);
    expect(restored.host.messages).toEqual(["restored battle quick resolved"]);
  });

  it("resets restored after-damage-calculation passes after a Lua quick effect resolves", () => {
    const fixture = setupRestoredBattleQuick("EFFECT_FLAG_DAMAGE_STEP");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    expect(fixture.session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    passBattleResponse(fixture.session, 1, "passDamage");
    expect(fixture.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "afterDamageCalculation", responsePlayer: 0 } });

    const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "afterDamageCalculation", responsePlayer: 0 } });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const quick = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect");
    expect(quick).toMatchObject({ player: 0, windowKind: "battle" });

    const staleBeforeQuick = applyLuaRestoreResponse(restored, { ...quick!, windowId: quick!.windowId! - 1 });
    expect(staleBeforeQuick.ok).toBe(false);
    expect(staleBeforeQuick.error).toContain("Response is not currently legal");
    expect(staleBeforeQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleBeforeQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleBeforeQuick, staleBeforeQuick.state.waitingFor!);
    expect(restored.session.state.damagePasses).toEqual([1]);
    expect(restored.host.messages).toEqual([]);

    const result = applyLuaRestoreAndAssert(restored, quick!);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", damagePasses: [], battleWindow: { kind: "afterDamageCalculation", responsePlayer: 0 } });
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passChain", player: 1, windowKind: "chainResponse" })]));
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 1, windowKind: "chainResponse", uid: expect.stringContaining("400") })]));
    expect(result.legalActions.some((action) => action.type === "activateEffect" && action.uid.includes("500"))).toBe(false);
    expect(getDuelLegalActions(restored.session, 0)).toEqual([]);

    const staleQuick = applyLuaRestoreResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleQuick, staleQuick.state.waitingFor!);

    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreAndAssert(restored, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleWindow: { kind: "afterDamageCalculation", responsePlayer: 1 } });
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(resolved.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);
    expect(resolved.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(resolved.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 1, windowKind: "battle", uid: expect.stringContaining("500") })]));

    const stalePass = applyLuaRestoreResponse(restored, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, stalePass, stalePass.state.waitingFor!);
    expect(restored.host.messages).toEqual(["restored battle quick resolved"]);
  });

  it("resets restored end-damage-step passes after a Lua quick effect resolves", () => {
    const fixture = setupRestoredBattleQuick("EFFECT_FLAG_DAMAGE_STEP");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    expect(fixture.session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    expect(fixture.session.state.battleWindow?.kind).toBe("endDamageStep");
    passBattleResponse(fixture.session, 1, "passDamage");
    expect(fixture.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "endDamageStep", responsePlayer: 0 } });

    const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "endDamageStep", responsePlayer: 0 } });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const quick = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect");
    expect(quick).toMatchObject({ player: 0, windowKind: "battle" });

    const staleBeforeQuick = applyLuaRestoreResponse(restored, { ...quick!, windowId: quick!.windowId! - 1 });
    expect(staleBeforeQuick.ok).toBe(false);
    expect(staleBeforeQuick.error).toContain("Response is not currently legal");
    expect(staleBeforeQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleBeforeQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleBeforeQuick, staleBeforeQuick.state.waitingFor!);
    expect(restored.session.state.damagePasses).toEqual([1]);
    expect(restored.host.messages).toEqual([]);

    const result = applyLuaRestoreAndAssert(restored, quick!);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", damagePasses: [], battleWindow: { kind: "endDamageStep", responsePlayer: 0 } });
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passChain", player: 1, windowKind: "chainResponse" })]));
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 1, windowKind: "chainResponse", uid: expect.stringContaining("400") })]));
    expect(result.legalActions.some((action) => action.type === "activateEffect" && action.uid.includes("500"))).toBe(false);
    expect(getDuelLegalActions(restored.session, 0)).toEqual([]);

    const staleQuick = applyLuaRestoreResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleQuick, staleQuick.state.waitingFor!);

    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreAndAssert(restored, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleWindow: { kind: "endDamageStep", responsePlayer: 1 } });
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(resolved.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);
    expect(resolved.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(resolved.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 1, windowKind: "battle", uid: expect.stringContaining("500") })]));

    const stalePass = applyLuaRestoreResponse(restored, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, stalePass, stalePass.state.waitingFor!);
    expect(restored.host.messages).toEqual(["restored battle quick resolved"]);
  });

  it("cleans up restored end-damage-step windows after both players pass", () => {
    const fixture = setupRestoredBattleQuick("EFFECT_FLAG_DAMAGE_STEP");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    passBattleResponse(fixture.session, 1, "passDamage");
    passBattleResponse(fixture.session, 0, "passDamage");
    expect(fixture.session.state.battleWindow?.kind).toBe("endDamageStep");
    passBattleResponse(fixture.session, 1, "passDamage");
    expect(fixture.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "endDamageStep", responsePlayer: 0 } });

    const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "endDamageStep", responsePlayer: 0 } });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const pass = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "passDamage");
    expect(pass).toMatchObject({ player: 0, windowKind: "battle" });

    const staleBeforePass = applyLuaRestoreResponse(restored, { ...pass!, windowId: pass!.windowId! - 1 });
    expect(staleBeforePass.ok).toBe(false);
    expect(staleBeforePass.error).toContain("Response is not currently legal");
    expect(staleBeforePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforePass.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleBeforePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleBeforePass, staleBeforePass.state.waitingFor!);
    expect(restored.session.state).toMatchObject({ damagePasses: [1], battleWindow: { kind: "endDamageStep", responsePlayer: 0 }, players: { 1: { lifePoints: 6200 } } });

    const result = applyLuaRestoreAndAssert(restored, pass!);
    expect(result.state).toMatchObject({ waitingFor: 0, windowKind: "open", damagePasses: [], players: { 1: { lifePoints: 6200 } } });
    expect(result.state.battleWindow).toBeUndefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(getDuelLegalActions(restored.session, 1)).toEqual([]);
    expect(restored.session.state.players[1].lifePoints).toBe(6200);
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.battleWindow).toBeUndefined();

    const stalePass = applyLuaRestoreResponse(restored, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, stalePass, stalePass.state.waitingFor!);
    expect(restored.host.messages).toEqual([]);
  });

  it("queues Lua battle-damage triggers after restored end-damage-step cleanup", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Cleanup Trigger Attacker", kind: "monster", attack: 1800 },
      { code: "500", name: "Restore Cleanup Battle Damage Trigger", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c500.lua") return undefined;
        return `
        c500={}
        function c500.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_BATTLE_DAMAGE)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg,ep,ev,re,r)
            Debug.Message("restored cleanup battle damage " .. ep .. "/" .. ev .. "/" .. r .. "/" .. Duel.GetLP(1))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 58, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "500"] }, 1: { main: [] } });
    startDuel(session);
    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    const host = createLuaScriptHost(session);
    const triggerScript = host.loadCardScript(500, source);
    expect(triggerScript.ok, triggerScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    applyAndAssert(session, battle!);
    const attack = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleResponse(session, 1, "passAttack");
    passBattleResponse(session, 0, "passAttack");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    advanceToEndDamageStep(session);
    expect(session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleDamageDealt"]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.pendingTriggers).toHaveLength(1);
    expect(restored.session.state).toMatchObject({ battleWindow: { kind: "afterDamageCalculation", responsePlayer: 1 }, players: { 1: { lifePoints: 6200 } } });
    expect(restored.session.state.pendingTriggers).toHaveLength(1);
    expect(restored.session.state.eventHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventName: "beforeBattleDamage", eventCode: 1136, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 }),
      expect.objectContaining({ eventName: "battleDamageDealt", eventCode: 1143, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 }),
    ]));
    expect(restored.session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "battleDamageDealt", eventCode: 1143, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 })]));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toMatchObject({ player: 0, windowKind: "triggerBucket" });
    const staleBeforeTrigger = applyLuaRestoreResponse(restored, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleBeforeTrigger.ok).toBe(false);
    expect(staleBeforeTrigger.error).toContain("Response is not currently legal");
    expect(staleBeforeTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleBeforeTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleBeforeTrigger, staleBeforeTrigger.state.waitingFor!);
    expect(restored.session.state.pendingTriggers).toHaveLength(1);
    expect(restored.host.messages).toEqual([]);

    const triggerResult = applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toEqual(["restored cleanup battle damage 1/1800/32/6200"]);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.pendingBattle).toBeDefined();
    expect(restored.session.state.battleWindow).toMatchObject({ kind: "afterDamageCalculation", responsePlayer: 1 });
    expect(triggerResult.state).toMatchObject({ waitingFor: 1, windowKind: "battle", players: { 1: { lifePoints: 6200 } } });
    const staleTrigger = applyLuaRestoreResponse(restored, trigger!);
    expect(staleTrigger.ok).toBe(false);
    expect(staleTrigger.error).toContain("Response is not currently legal");
    expect(staleTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, staleTrigger.state.waitingFor!));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, staleTrigger.state.waitingFor!));
    assertLuaRestoreLegalWindow(restored, staleTrigger, staleTrigger.state.waitingFor!);
  });

  it("queues Lua pre-battle-damage triggers after restored end-damage-step cleanup", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Cleanup Pre-Damage Attacker", kind: "monster", attack: 1800 },
      { code: "500", name: "Restore Cleanup Pre-Battle Damage Trigger", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c500.lua") return undefined;
        return `
        c500={}
        function c500.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_PRE_BATTLE_DAMAGE)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg,ep,ev,re,r)
            Debug.Message("restored cleanup pre battle damage " .. ep .. "/" .. ev .. "/" .. r .. "/" .. Duel.GetReasonPlayer() .. "/" .. Duel.GetLP(1))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 60, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "500"] }, 1: { main: [] } });
    startDuel(session);
    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    const host = createLuaScriptHost(session);
    const triggerScript = host.loadCardScript(500, source);
    expect(triggerScript.ok, triggerScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    applyAndAssert(session, battle!);
    const attack = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === undefined);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleResponse(session, 1, "passAttack");
    passBattleResponse(session, 0, "passAttack");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    advanceToEndDamageStep(session);
    expect(session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["beforeBattleDamage"]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.pendingTriggers).toHaveLength(1);
    expect(restored.session.state).toMatchObject({ battleWindow: { kind: "afterDamageCalculation", responsePlayer: 1 }, players: { 1: { lifePoints: 6200 } } });
    expect(restored.session.state.pendingTriggers).toHaveLength(1);
    expect(restored.session.state.eventHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventName: "beforeBattleDamage", eventCode: 1136, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 }),
      expect.objectContaining({ eventName: "battleDamageDealt", eventCode: 1143, eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 }),
    ]));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toMatchObject({ player: 0, windowKind: "triggerBucket" });
    const staleBeforeTrigger = applyLuaRestoreResponse(restored, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleBeforeTrigger.ok).toBe(false);
    expect(staleBeforeTrigger.error).toContain("Response is not currently legal");
    expect(staleBeforeTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleBeforeTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleBeforeTrigger, staleBeforeTrigger.state.waitingFor!);
    expect(restored.session.state.pendingTriggers).toHaveLength(1);
    expect(restored.host.messages).toEqual([]);

    const triggerResult = applyLuaRestoreAndAssert(restored, trigger!);
    expect(triggerResult.state).toMatchObject({ waitingFor: 1, windowKind: "battle", players: { 1: { lifePoints: 6200 } } });
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(triggerResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggerResult.legalActions);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.pendingBattle).toBeDefined();
    expect(restored.session.state.battleWindow).toMatchObject({ kind: "afterDamageCalculation", responsePlayer: 1 });
    expect(restored.host.messages).toEqual(["restored cleanup pre battle damage 1/1800/32/0/6200"]);
    const staleTrigger = applyLuaRestoreResponse(restored, trigger!);
    expect(staleTrigger.ok).toBe(false);
    expect(staleTrigger.error).toContain("Response is not currently legal");
    expect(staleTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, staleTrigger.state.waitingFor!));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, staleTrigger.state.waitingFor!));
    assertLuaRestoreLegalWindow(restored, staleTrigger, staleTrigger.state.waitingFor!);
  });

  it("queues Lua counter battle-damage triggers after restored end-damage-step cleanup", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Counter Damage Attacker", kind: "monster", attack: 1000 },
      { code: "200", name: "Restore Counter Damage Defender", kind: "monster", attack: 1800 },
      { code: "500", name: "Restore Counter Battle Damage Trigger", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c500.lua") return undefined;
        return `
        c500={}
        function c500.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_BATTLE_DAMAGE)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg,ep,ev,re,r)
            Debug.Message("restored cleanup counter battle damage " .. ep .. "/" .. ev .. "/" .. r .. "/" .. Duel.GetReasonPlayer() .. "/" .. Duel.GetLP(0))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 59, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "500"] }, 1: { main: ["200"] } });
    startDuel(session);
    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const defender = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "200");
    expect(attacker).toBeDefined();
    expect(defender).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1).position = "faceUpAttack";
    const host = createLuaScriptHost(session);
    const triggerScript = host.loadCardScript(500, source);
    expect(triggerScript.ok, triggerScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    applyAndAssert(session, battle!);
    const attack = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === defender!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleResponse(session, 1, "passAttack");
    passBattleResponse(session, 0, "passAttack");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    passBattleResponse(session, 1, "passDamage");
    passBattleResponse(session, 0, "passDamage");
    expect(session.state.battleWindow?.kind).toBe("endDamageStep");
    passBattleResponse(session, 1, "passDamage");
    expect(session.state).toMatchObject({ waitingFor: 0, damagePasses: [1], battleWindow: { kind: "endDamageStep", responsePlayer: 0 } });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    const pass = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "passDamage");
    expect(pass).toMatchObject({ player: 0, windowKind: "battle" });
    const staleBeforePass = applyLuaRestoreResponse(restored, { ...pass!, windowId: pass!.windowId! - 1 });
    expect(staleBeforePass.ok).toBe(false);
    expect(staleBeforePass.error).toContain("Response is not currently legal");
    expect(staleBeforePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforePass.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleBeforePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleBeforePass, staleBeforePass.state.waitingFor!);
    expect(restored.session.state).toMatchObject({ damagePasses: [1], pendingTriggers: [], battleWindow: { kind: "endDamageStep", responsePlayer: 0 }, players: { 0: { lifePoints: 7200 } } });

    const cleaned = applyLuaRestoreAndAssert(restored, pass!);
    expect(cleaned.state).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket", players: { 0: { lifePoints: 7200 } } });
    expect(cleaned.legalActionGroups.flatMap((group) => group.actions)).toEqual(cleaned.legalActions);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["battleDamageDealt"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1143, eventPlayer: 0, eventValue: 800, eventReason: 0x20, eventReasonPlayer: 1 });
    expect(restored.session.state.eventHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventName: "beforeBattleDamage", eventCode: 1136, eventPlayer: 0, eventValue: 800, eventReason: 0x20, eventReasonPlayer: 1 }),
      expect.objectContaining({ eventName: "battleDamageDealt", eventCode: 1143, eventPlayer: 0, eventValue: 800, eventReason: 0x20, eventReasonPlayer: 1 }),
    ]));
    expect(restored.session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "battleDamageDealt", eventCode: 1143, eventPlayer: 0, eventValue: 800, eventReason: 0x20, eventReasonPlayer: 1 })]));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const stalePass = applyLuaRestoreResponse(restored, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, stalePass, stalePass.state.waitingFor!);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toMatchObject({ player: 0, windowKind: "triggerBucket" });
    const staleBeforeTrigger = applyLuaRestoreResponse(restored, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleBeforeTrigger.ok).toBe(false);
    expect(staleBeforeTrigger.error).toContain("Response is not currently legal");
    expect(staleBeforeTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleBeforeTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleBeforeTrigger, staleBeforeTrigger.state.waitingFor!);
    expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual(["battleDamageDealt"]);
    expect(restored.host.messages).toEqual([]);

    const triggerResult = applyLuaRestoreAndAssert(restored, trigger!);
    expect(triggerResult.state).toMatchObject({ waitingFor: 0, windowKind: "open", players: { 0: { lifePoints: 7200 } } });
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(triggerResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggerResult.legalActions);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.battleWindow).toBeUndefined();
    expect(restored.host.messages).toEqual(["restored cleanup counter battle damage 0/800/32/1/7200"]);
    const staleTrigger = applyLuaRestoreResponse(restored, trigger!);
    expect(staleTrigger.ok).toBe(false);
    expect(staleTrigger.error).toContain("Response is not currently legal");
    expect(staleTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, staleTrigger.state.waitingFor!));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, staleTrigger.state.waitingFor!));
    assertLuaRestoreLegalWindow(restored, staleTrigger, staleTrigger.state.waitingFor!);
  });
});
