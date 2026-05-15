import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe("Lua open fast priority restore", () => {
  it("alternates live and restored fast-effect response priority after open quick effects", () => {
    const cards: DuelCardData[] = [
      { code: "20100", name: "Lua Live Open Fast Starter", kind: "monster" },
      { code: "20200", name: "Lua Live Turn Chain Fast", kind: "monster" },
      { code: "20300", name: "Lua Live Opponent Chain Fast", kind: "monster" },
      { code: "20400", name: "Lua Live Fast Filler", kind: "monster" },
      { code: "20500", name: "Lua Live Opponent Open Fast", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c20100.lua") {
          return `
          c20100={}
          function c20100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()==0 end)
            e:SetOperation(function(e,tp) Debug.Message("live open fast starter resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c20200.lua") {
          return `
          c20200={}
          function c20200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCountLimit(1)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
            e:SetOperation(function(e,tp) Debug.Message("live turn chain fast resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c20300.lua") {
          return `
          c20300={}
          function c20300.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCountLimit(1)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
            e:SetOperation(function(e,tp) Debug.Message("live opponent chain fast resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c20500.lua") {
          return `
          c20500={}
          function c20500.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()==0 end)
            e:SetOperation(function(e,tp) Debug.Message("live opponent open fast resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 100, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["20100", "20200"] }, 1: { main: ["20300", "20500"] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    const starterScript = host.loadCardScript(20100, source);
    const turnQuickScript = host.loadCardScript(20200, source);
    const opponentQuickScript = host.loadCardScript(20300, source);
    const opponentOpenQuickScript = host.loadCardScript(20500, source);
    expect(starterScript.ok, starterScript.error).toBe(true);
    expect(turnQuickScript.ok, turnQuickScript.error).toBe(true);
    expect(opponentQuickScript.ok, opponentQuickScript.error).toBe(true);
    expect(opponentOpenQuickScript.ok, opponentOpenQuickScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const starter = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid.includes("20100"));
    expect(starter).toMatchObject({ player: 0, windowKind: "open" });
    const opened = applyAndAssert(session, starter!);
    expect(opened.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(getDuelLegalActions(session, 0)).toEqual([]);

    const opponentQuick = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid.includes("20300"));
    expect(opponentQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
    const opponentChained = applyAndAssert(session, opponentQuick!);
    expect(opponentChained.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    const originalTurnQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid.includes("20200"));
    expect(originalTurnQuick).toMatchObject({ player: 0, windowKind: "chainResponse" });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid.includes("20500"))).toBe(false);
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 0), 0, "20500", "chainResponse")).toBe(false);

    const turnQuick = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid.includes("20200"));
    expect(turnQuick).toMatchObject({ player: 0, windowKind: "chainResponse" });
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 0), 0, "20200", "chainResponse")).toBe(true);
    const staleBeforeTurnQuick = applyLuaRestoreResponse(restored, { ...turnQuick!, windowId: turnQuick!.windowId! - 1 });
    expect(staleBeforeTurnQuick.ok).toBe(false);
    expect(staleBeforeTurnQuick.error).toContain("Response is not currently legal");
    expect(staleBeforeTurnQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeTurnQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleBeforeTurnQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleBeforeTurnQuick, staleBeforeTurnQuick.state.waitingFor!);
    expect(restored.host.messages).toEqual([]);
    const originalTurnQuickPreapply = applyLuaRestoreResponse(restored, originalTurnQuick!);
    expect(originalTurnQuickPreapply.ok).toBe(false);
    expect(originalTurnQuickPreapply.error).toContain("Response is not currently legal");

    const turnChained = applyLuaRestoreAndAssert(restored, turnQuick!);
    expect(turnChained.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(turnChained.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 0, windowKind: "open", uid: expect.stringContaining("20100") })]));
    expect(hasGroupedLuaEffect(turnChained.legalActionGroups, 0, "20100", "open")).toBe(true);
    expect(getDuelLegalActions(restored.session, 1)).toEqual([]);
    assertLuaFinalOpenRestore(restored, source);
    const staleTurnQuick = applyLuaRestoreResponse(restored, turnQuick!);
    expect(staleTurnQuick.ok).toBe(false);
    expect(staleTurnQuick.error).toContain("Response is not currently legal");
    expect(staleTurnQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleTurnQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleTurnQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleTurnQuick, staleTurnQuick.state.waitingFor!);
    expect(host.messages).toEqual([]);
    expect(restored.host.messages).toEqual(["live turn chain fast resolved", "live opponent chain fast resolved", "live open fast starter resolved"]);
  });

  it("activates restored open fast effects and rejects stale restored open actions", () => {
    const cards: DuelCardData[] = [
      { code: "18100", name: "Lua Restored Open Fast Source", kind: "monster" },
      { code: "18200", name: "Lua Restored Open Fast Quick", kind: "monster" },
      { code: "18300", name: "Lua Restored Open Fast Opponent Chain Quick", kind: "monster" },
      { code: "18400", name: "Lua Restored Open Fast Filler", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c18100.lua") {
          return `
          c18100={}
          function c18100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("restored open fast source resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c18200.lua") {
          return `
          c18200={}
          function c18200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()==0 end)
            e:SetOperation(function(e,tp) Debug.Message("restored open fast quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c18300.lua") {
          return `
          c18300={}
          function c18300.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
            e:SetOperation(function(e,tp) Debug.Message("restored open fast opponent chain quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 98, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["18100", "18200"] }, 1: { main: ["18300", "18400"] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    const sourceScript = host.loadCardScript(18100, source);
    const openQuickScript = host.loadCardScript(18200, source);
    const chainQuickScript = host.loadCardScript(18300, source);
    expect(sourceScript.ok, sourceScript.error).toBe(true);
    expect(openQuickScript.ok, openQuickScript.error).toBe(true);
    expect(chainQuickScript.ok, chainQuickScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid.includes("18100"));
    expect(sourceAction).toBeDefined();
    expect(applyAndAssert(session, sourceAction!).state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    const originalChainPass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(originalChainPass).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    const chainPass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(chainPass).toBeDefined();
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(hasGroupedPass(getLuaRestoreLegalActionGroups(restored, 1), 1)).toBe(true);
    const staleBeforeChainPass = applyLuaRestoreResponse(restored, { ...chainPass!, windowId: chainPass!.windowId! - 1 });
    expect(staleBeforeChainPass.ok).toBe(false);
    expect(staleBeforeChainPass.error).toContain("Response is not currently legal");
    expect(staleBeforeChainPass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeChainPass.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleBeforeChainPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleBeforeChainPass, staleBeforeChainPass.state.waitingFor!);
    const originalChainPassPreapply = applyLuaRestoreResponse(restored, originalChainPass!);
    expect(originalChainPassPreapply.ok).toBe(false);
    expect(originalChainPassPreapply.error).toContain("Response is not currently legal");
    expect(originalChainPassPreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(restored.host.messages).toEqual([]);

    const opened = applyLuaRestoreAndAssert(restored, chainPass!);
    expect(opened.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(opened.legalActions.some((action) => action.type === "activateEffect" && action.uid.includes("18300"))).toBe(false);
    expect(hasGroupedLuaEffect(opened.legalActionGroups, 1, "18300", "open")).toBe(false);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, createCardReader(cards));
    expect(restoredOpenWindow.restoreComplete, restoredOpenWindow.incompleteReasons.join("; ")).toBe(true);
    expect(queryPublicState(restoredOpenWindow.session)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpenWindow.session.state.chainPasses).toEqual([]);
    expect(actionsWithoutWindowToken(getLuaRestoreLegalActions(restoredOpenWindow, 0))).toEqual(actionsWithoutWindowToken(getLuaRestoreLegalActions(restored, 0)));
    expect(groupsWithoutWindowToken(getLuaRestoreLegalActionGroups(restoredOpenWindow, 0))).toEqual(groupsWithoutWindowToken(getLuaRestoreLegalActionGroups(restored, 0)));
    expect(getLuaRestoreLegalActions(restoredOpenWindow, 1)).toEqual([]);

    const staleChainPass = applyLuaRestoreResponse(restored, chainPass!);
    expect(staleChainPass.ok).toBe(false);
    expect(staleChainPass.error).toContain("Response is not currently legal");
    expect(staleChainPass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleChainPass.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleChainPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleChainPass, staleChainPass.state.waitingFor!);

    const quick = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid.includes("18200"));
    expect(quick).toMatchObject({ player: 0, windowKind: "open" });
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 0), 0, "18200", "open")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const staleBeforeQuick = applyLuaRestoreResponse(restored, { ...quick!, windowId: quick!.windowId! - 1 });
    expect(staleBeforeQuick.ok).toBe(false);
    expect(staleBeforeQuick.error).toContain("Response is not currently legal");
    expect(staleBeforeQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleBeforeQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleBeforeQuick, staleBeforeQuick.state.waitingFor!);
    expect(restored.host.messages).toEqual(["restored open fast source resolved"]);

    const quickResult = applyLuaRestoreAndAssert(restored, quick!);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid.includes("18300"))).toBe(true);
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 1), 1, "18300", "chainResponse")).toBe(true);

    const staleQuick = applyLuaRestoreResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleQuick, staleQuick.state.waitingFor!);

    const opponentChainQuick = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect" && action.uid.includes("18300"));
    expect(opponentChainQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
    const opponentChainResult = applyLuaRestoreAndAssert(restored, opponentChainQuick!);
    expect(opponentChainResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(opponentChainResult.state.chain.map((link) => link.sourceUid)).toEqual([
      expect.stringContaining("18200"),
      expect.stringContaining("18300"),
    ]);
    expect(restored.host.messages).toEqual(["restored open fast source resolved"]);
    const restoredFinalResponse = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, createCardReader(cards));
    expect(restoredFinalResponse.restoreComplete, restoredFinalResponse.incompleteReasons.join("; ")).toBe(true);
    expect(queryPublicState(restoredFinalResponse.session)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(restoredFinalResponse.session.state.chain.map((link) => link.sourceUid)).toEqual([
      expect.stringContaining("18200"),
      expect.stringContaining("18300"),
    ]);
    expect(getLuaRestoreLegalActions(restoredFinalResponse, 0)).toEqual([]);
    expect(actionsWithoutWindowToken(getLuaRestoreLegalActions(restoredFinalResponse, 1))).toEqual(actionsWithoutWindowToken(getLuaRestoreLegalActions(restored, 1)));
    expect(groupsWithoutWindowToken(getLuaRestoreLegalActionGroups(restoredFinalResponse, 1))).toEqual(groupsWithoutWindowToken(getLuaRestoreLegalActionGroups(restored, 1)));
    expect(getLuaRestoreLegalActionGroups(restoredFinalResponse, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredFinalResponse, 1));
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restoredFinalResponse, 1), 1, "18300", "chainResponse")).toBe(true);
    const restoredOpponentChainQuick = getLuaRestoreLegalActions(restoredFinalResponse, 1).find((action) => action.type === "activateEffect" && action.uid.includes("18300"));
    expect(restoredOpponentChainQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
    const restoredOpponentChainResult = applyLuaRestoreAndAssert(restoredFinalResponse, restoredOpponentChainQuick!);
    expect(restoredOpponentChainResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(restoredOpponentChainResult.state.chain.map((link) => link.sourceUid)).toEqual([
      expect.stringContaining("18200"),
      expect.stringContaining("18300"),
      expect.stringContaining("18300"),
    ]);
    const restoredFinalPass = getLuaRestoreLegalActions(restoredFinalResponse, 1).find((action) => action.type === "passChain");
    expect(restoredFinalPass).toBeDefined();
    expect(hasGroupedPass(getLuaRestoreLegalActionGroups(restoredFinalResponse, 1), 1)).toBe(true);
    const restoredFinalOpened = applyLuaRestoreAndAssert(restoredFinalResponse, restoredFinalPass!);
    expect(restoredFinalOpened.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(restoredFinalResponse.session.state.chainPasses).toEqual([]);
    expect(restoredFinalResponse.host.messages).toEqual([
      "restored open fast opponent chain quick resolved",
      "restored open fast opponent chain quick resolved",
      "restored open fast quick resolved",
    ]);

    const staleOpponentChainQuick = applyLuaRestoreResponse(restored, opponentChainQuick!);
    expect(staleOpponentChainQuick.ok).toBe(false);
    expect(staleOpponentChainQuick.error).toContain("Response is not currently legal");
    expect(staleOpponentChainQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleOpponentChainQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleOpponentChainQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleOpponentChainQuick, staleOpponentChainQuick.state.waitingFor!);

    const finalPass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(finalPass).toBeDefined();
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(hasGroupedPass(getLuaRestoreLegalActionGroups(restored, 1), 1)).toBe(true);
    const staleBeforeFinalPass = applyLuaRestoreResponse(restored, { ...finalPass!, windowId: finalPass!.windowId! - 1 });
    expect(staleBeforeFinalPass.ok).toBe(false);
    expect(staleBeforeFinalPass.error).toContain("Response is not currently legal");
    expect(staleBeforeFinalPass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeFinalPass.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleBeforeFinalPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleBeforeFinalPass, staleBeforeFinalPass.state.waitingFor!);

    applyLuaRestoreAndAssert(restored, finalPass!);
    const staleFinalPass = applyLuaRestoreResponse(restored, finalPass!);
    expect(staleFinalPass.ok).toBe(false);
    expect(staleFinalPass.error).toContain("Response is not currently legal");
    expect(staleFinalPass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleFinalPass.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleFinalPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleFinalPass, staleFinalPass.state.waitingFor!);
    expect(restored.host.messages).toEqual(["restored open fast source resolved", "restored open fast opponent chain quick resolved", "restored open fast quick resolved"]);
  });

  it("opens restored fast effects after restored trigger chains resolve", () => {
    const cards: DuelCardData[] = [
      { code: "19100", name: "Lua Restored Trigger Fast Summon", kind: "monster" },
      { code: "19200", name: "Lua Restored Trigger Fast Trigger", kind: "monster" },
      { code: "19300", name: "Lua Restored Trigger Fast Quick", kind: "monster" },
      { code: "19400", name: "Lua Restored Trigger Fast Chain Quick", kind: "monster" },
      { code: "19500", name: "Lua Restored Trigger Fast Filler", kind: "monster" },
      { code: "19600", name: "Lua Restored Trigger Fast Turn Chain Quick", kind: "monster" },
      { code: "19700", name: "Lua Restored Trigger Fast Opponent Open Quick", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c19200.lua") {
          return `
          c19200={}
          function c19200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_F)
            e:SetCode(EVENT_SUMMON_SUCCESS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("restored trigger fast trigger resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c19300.lua") {
          return `
          c19300={}
          function c19300.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()==0 end)
            e:SetOperation(function(e,tp) Debug.Message("restored trigger fast quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c19400.lua") {
          return `
          c19400={}
          function c19400.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
            e:SetOperation(function(e,tp) Debug.Message("restored trigger fast chain quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c19600.lua") {
          return `
          c19600={}
          function c19600.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCountLimit(1)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
            e:SetOperation(function(e,tp) Debug.Message("restored trigger fast turn chain quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c19700.lua") {
          return `
          c19700={}
          function c19700.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()==0 end)
            e:SetOperation(function(e,tp) Debug.Message("restored trigger fast opponent open quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 99, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["19100", "19200", "19300", "19600"] }, 1: { main: ["19400", "19700", "19500", "19500"] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    const triggerScript = host.loadCardScript(19200, source);
    const openQuickScript = host.loadCardScript(19300, source);
    const opponentChainQuickScript = host.loadCardScript(19400, source);
    const turnChainQuickScript = host.loadCardScript(19600, source);
    const opponentOpenQuickScript = host.loadCardScript(19700, source);
    expect(triggerScript.ok, triggerScript.error).toBe(true);
    expect(openQuickScript.ok, openQuickScript.error).toBe(true);
    expect(opponentChainQuickScript.ok, opponentChainQuickScript.error).toBe(true);
    expect(turnChainQuickScript.ok, turnChainQuickScript.error).toBe(true);
    expect(opponentOpenQuickScript.ok, opponentOpenQuickScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "19100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    const summoned = applyAndAssert(session, summon!);
    expect(summoned.state).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket" });
    expect(summoned.state.pendingTriggers.map((trigger) => trigger.effectId)).toHaveLength(1);
    const originalTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(originalTrigger).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger");
    expect(trigger).toMatchObject({ player: 0, windowKind: "triggerBucket", triggerBucket: "turnMandatory" });
    const staleBeforeTrigger = applyLuaRestoreResponse(restored, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleBeforeTrigger.ok).toBe(false);
    expect(staleBeforeTrigger.error).toContain("Response is not currently legal");
    expect(staleBeforeTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleBeforeTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleBeforeTrigger, staleBeforeTrigger.state.waitingFor!);
    const originalTriggerPreapply = applyLuaRestoreResponse(restored, originalTrigger!);
    expect(originalTriggerPreapply.ok).toBe(false);
    expect(originalTriggerPreapply.error).toContain("Response is not currently legal");
    expect(originalTriggerPreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(restored.host.messages).toEqual([]);

    const triggerResult = applyLuaRestoreAndAssert(restored, trigger!);
    expect(triggerResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid.includes("19700"))).toBe(false);
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 1), 1, "19700", "chainResponse")).toBe(false);
    const staleTrigger = applyLuaRestoreResponse(restored, trigger!);
    expect(staleTrigger.ok).toBe(false);
    expect(staleTrigger.error).toContain("Response is not currently legal");
    expect(staleTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleTrigger, staleTrigger.state.waitingFor!);

    const chainQuick = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect" && action.uid.includes("19400"));
    expect(chainQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 1), 1, "19400", "chainResponse")).toBe(true);
    const staleBeforeChainQuick = applyLuaRestoreResponse(restored, { ...chainQuick!, windowId: chainQuick!.windowId! - 1 });
    expect(staleBeforeChainQuick.ok).toBe(false);
    expect(staleBeforeChainQuick.error).toContain("Response is not currently legal");
    expect(staleBeforeChainQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeChainQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleBeforeChainQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleBeforeChainQuick, staleBeforeChainQuick.state.waitingFor!);
    expect(restored.host.messages).toEqual([]);

    const chainQuickResult = applyLuaRestoreAndAssert(restored, chainQuick!);
    expect(chainQuickResult.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(hasGroupedLuaEffect(chainQuickResult.legalActionGroups, 0, "19600", "chainResponse")).toBe(true);
    expect(hasGroupedLuaEffect(chainQuickResult.legalActionGroups, 0, "19300", "chainResponse")).toBe(false);

    const staleChainQuick = applyLuaRestoreResponse(restored, chainQuick!);
    expect(staleChainQuick.ok).toBe(false);
    expect(staleChainQuick.error).toContain("Response is not currently legal");
    expect(staleChainQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleChainQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleChainQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleChainQuick, staleChainQuick.state.waitingFor!);

    const turnChainQuick = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid.includes("19600"));
    expect(turnChainQuick).toMatchObject({ player: 0, windowKind: "chainResponse" });
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 0), 0, "19600", "chainResponse")).toBe(true);
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 0), 0, "19300", "chainResponse")).toBe(false);
    const staleBeforeTurnChainQuick = applyLuaRestoreResponse(restored, { ...turnChainQuick!, windowId: turnChainQuick!.windowId! - 1 });
    expect(staleBeforeTurnChainQuick.ok).toBe(false);
    expect(staleBeforeTurnChainQuick.error).toContain("Response is not currently legal");
    expect(staleBeforeTurnChainQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeTurnChainQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleBeforeTurnChainQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleBeforeTurnChainQuick, staleBeforeTurnChainQuick.state.waitingFor!);
    expect(restored.host.messages).toEqual([]);

    const turnChainQuickResult = applyLuaRestoreAndAssert(restored, turnChainQuick!);
    expect(turnChainQuickResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(turnChainQuickResult.state.chain.map((link) => link.sourceUid)).toEqual([
      expect.stringContaining("19200"),
      expect.stringContaining("19400"),
      expect.stringContaining("19600"),
    ]);
    const restoredOpponentResponse = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, createCardReader(cards));
    expect(restoredOpponentResponse.restoreComplete, restoredOpponentResponse.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredOpponentResponse, 1);
    expect(queryPublicState(restoredOpponentResponse.session)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(restoredOpponentResponse.session.state.chain.map((link) => link.sourceUid)).toEqual([
      expect.stringContaining("19200"),
      expect.stringContaining("19400"),
      expect.stringContaining("19600"),
    ]);
    expect(getLuaRestoreLegalActions(restoredOpponentResponse, 0)).toEqual([]);
    expect(actionsWithoutWindowToken(getLuaRestoreLegalActions(restoredOpponentResponse, 1))).toEqual(actionsWithoutWindowToken(getLuaRestoreLegalActions(restored, 1)));
    expect(groupsWithoutWindowToken(getLuaRestoreLegalActionGroups(restoredOpponentResponse, 1))).toEqual(groupsWithoutWindowToken(getLuaRestoreLegalActionGroups(restored, 1)));
    expect(getLuaRestoreLegalActionGroups(restoredOpponentResponse, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredOpponentResponse, 1));
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restoredOpponentResponse, 1), 1, "19700", "chainResponse")).toBe(false);

    const staleTurnChainQuick = applyLuaRestoreResponse(restored, turnChainQuick!);
    expect(staleTurnChainQuick.ok).toBe(false);
    expect(staleTurnChainQuick.error).toContain("Response is not currently legal");
    expect(staleTurnChainQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleTurnChainQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleTurnChainQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleTurnChainQuick, staleTurnChainQuick.state.waitingFor!);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(hasGroupedPass(getLuaRestoreLegalActionGroups(restored, 1), 1)).toBe(true);
    const staleBeforePass = applyLuaRestoreResponse(restored, { ...pass!, windowId: pass!.windowId! - 1 });
    expect(staleBeforePass.ok).toBe(false);
    expect(staleBeforePass.error).toContain("Response is not currently legal");
    expect(staleBeforePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforePass.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleBeforePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleBeforePass, staleBeforePass.state.waitingFor!);
    expect(restored.host.messages).toEqual([]);

    const opened = applyLuaRestoreAndAssert(restored, pass!);
    expect(opened.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(opened.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 0, windowKind: "open", uid: expect.stringContaining("19300") })]));
    expect(opened.legalActions.some((action) => action.type === "activateEffect" && action.uid.includes("19600"))).toBe(false);
    expect(getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid.includes("19700"))).toBe(false);
    expect(hasGroupedLuaEffect(opened.legalActionGroups, 0, "19300", "open")).toBe(true);
    expect(hasGroupedLuaEffect(opened.legalActionGroups, 0, "19600", "open")).toBe(false);
    expect(hasGroupedLuaEffect(opened.legalActionGroups, 1, "19400", "open")).toBe(false);
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 0), 0, "19700", "open")).toBe(false);

    const stalePass = applyLuaRestoreResponse(restored, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, stalePass, stalePass.state.waitingFor!);

    const quick = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid.includes("19300"));
    expect(quick).toMatchObject({ player: 0, windowKind: "open" });
    const staleBeforeQuick = applyLuaRestoreResponse(restored, { ...quick!, windowId: quick!.windowId! - 1 });
    expect(staleBeforeQuick.ok).toBe(false);
    expect(staleBeforeQuick.error).toContain("Response is not currently legal");
    expect(staleBeforeQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleBeforeQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleBeforeQuick, staleBeforeQuick.state.waitingFor!);
    expect(restored.host.messages).toEqual(["restored trigger fast turn chain quick resolved", "restored trigger fast chain quick resolved", "restored trigger fast trigger resolved"]);

    const quickResult = applyLuaRestoreAndAssert(restored, quick!);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });

    const staleQuick = applyLuaRestoreResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleQuick, staleQuick.state.waitingFor!);

    const finalPass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(finalPass).toBeDefined();
    expect(hasGroupedPass(getLuaRestoreLegalActionGroups(restored, 1), 1)).toBe(true);
    const staleBeforeFinalPass = applyLuaRestoreResponse(restored, { ...finalPass!, windowId: finalPass!.windowId! - 1 });
    expect(staleBeforeFinalPass.ok).toBe(false);
    expect(staleBeforeFinalPass.error).toContain("Response is not currently legal");
    expect(staleBeforeFinalPass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeFinalPass.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleBeforeFinalPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    assertLuaRestoreLegalWindow(restored, staleBeforeFinalPass, staleBeforeFinalPass.state.waitingFor!);

    const finalOpened = applyLuaRestoreAndAssert(restored, finalPass!);
    expect(finalOpened.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(finalOpened.legalActionGroups.flatMap((group) => group.actions)).toEqual(finalOpened.legalActions);
    expect(finalOpened.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 0, windowKind: "open", uid: expect.stringContaining("19300") })]));
    expect(hasGroupedLuaEffect(finalOpened.legalActionGroups, 0, "19300", "open")).toBe(true);
    expect(hasGroupedLuaEffect(finalOpened.legalActionGroups, 0, "19600", "open")).toBe(false);
    expect(hasGroupedLuaEffect(finalOpened.legalActionGroups, 1, "19700", "open")).toBe(false);

    const staleFinalPass = applyLuaRestoreResponse(restored, finalPass!);
    expect(staleFinalPass.ok).toBe(false);
    expect(staleFinalPass.error).toContain("Response is not currently legal");
    expect(staleFinalPass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleFinalPass.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleFinalPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleFinalPass, staleFinalPass.state.waitingFor!);

    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 0, windowKind: "open", uid: expect.stringContaining("19300") })]));
    expect(hasGroupedLuaEffect(getLuaRestoreLegalActionGroups(restored, 0), 0, "19300", "open")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    assertLuaFinalOpenRestore(restored, source);
    expect(restored.host.messages).toEqual(["restored trigger fast turn chain quick resolved", "restored trigger fast chain quick resolved", "restored trigger fast trigger resolved", "restored trigger fast quick resolved"]);
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  assertLuaRestoreLegalWindow(restored, response, response.state.waitingFor!);
  return response;
}

function assertLuaRestoreLegalWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: ReturnType<typeof applyLuaRestoreResponse>, player: 0 | 1) {
  const windowId = restored.session.state.actionWindowId;
  const publicState = queryPublicState(restored.session);
  expect(response.state.actionWindowId).toBe(windowId);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(response.state).not.toHaveProperty("triggerOrderPrompt");
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  for (const legalAction of response.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: response.state.windowKind });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: response.state.windowKind });
}

function assertLuaFinalOpenRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>, source: Parameters<typeof restoreDuelWithLuaScripts>[1]): void {
  const restoredFinalOpen = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, createCardReader(restored.session.state.cards.map((card) => card.data)));
  expect(restoredFinalOpen.restoreComplete, restoredFinalOpen.incompleteReasons.join("; ")).toBe(true);
  expect(restoredFinalOpen.session.state).toMatchObject({ waitingFor: 0, chain: [], pendingTriggers: [] });
  expect(restoredFinalOpen.session.state.chainPasses).toEqual([]);
  const publicFinalOpen = queryPublicState(restoredFinalOpen.session);
  expect(publicFinalOpen).toMatchObject({ windowKind: "open", pendingTriggerBuckets: [] });
  expect(publicFinalOpen).not.toHaveProperty("triggerOrderPrompt");
  expect(actionsWithoutWindowToken(getLuaRestoreLegalActions(restoredFinalOpen, 0))).toEqual(actionsWithoutWindowToken(getLuaRestoreLegalActions(restored, 0)));
  expect(groupsWithoutWindowToken(getLuaRestoreLegalActionGroups(restoredFinalOpen, 0))).toEqual(groupsWithoutWindowToken(getLuaRestoreLegalActionGroups(restored, 0)));
  expect(getLuaRestoreLegalActionGroups(restoredFinalOpen, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredFinalOpen, 0));
  expect(getLuaRestoreLegalActions(restoredFinalOpen, 1)).toEqual([]);
  expect(getLuaRestoreLegalActionGroups(restoredFinalOpen, 1)).toEqual([]);
}

function actionsWithoutWindowToken(actions: DuelAction[]): Array<Omit<DuelAction, "windowToken">> {
  return actions.map((action) => {
    const { windowToken: _windowToken, ...rest } = action;
    return rest;
  });
}

function groupsWithoutWindowToken(groups: DuelLegalActionGroup[]): Array<Omit<DuelLegalActionGroup, "windowToken">> {
  return groups.map((group) => {
    const { windowToken: _windowToken, ...rest } = group;
    return {
      ...rest,
      actions: actionsWithoutWindowToken(group.actions) as DuelAction[],
    };
  });
}

function hasGroupedLuaEffect(
  groups: ReturnType<typeof getLuaRestoreLegalActionGroups>,
  player: 0 | 1,
  code: string,
  windowKind: "chainResponse" | "open",
): boolean {
  return groups.some((group) =>
    group.windowKind === windowKind && group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.uid.includes(code) && action.windowKind === windowKind),
  );
}

function hasGroupedPass(groups: ReturnType<typeof getLuaRestoreLegalActionGroups>, player: 0 | 1): boolean {
  return groups.some(
    (group) =>
      group.windowKind === "chainResponse" &&
      group.actions.some((action) => action.type === "passChain" && action.player === player && action.windowId === group.windowId && action.windowKind === "chainResponse"),
  );
}
