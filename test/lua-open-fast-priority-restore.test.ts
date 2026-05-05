import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua open fast priority restore", () => {
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
    expect(host.loadCardScript(18100, source).ok).toBe(true);
    expect(host.loadCardScript(18200, source).ok).toBe(true);
    expect(host.loadCardScript(18300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid.includes("18100"));
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const chainPass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(chainPass).toBeDefined();
    const opened = applyLuaRestoreResponse(restored, chainPass!);
    expect(opened.ok, opened.error).toBe(true);
    expect(opened.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(opened.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(opened.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(opened.legalActionGroups.flatMap((group) => group.actions)).toEqual(opened.legalActions);

    const quick = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid.includes("18200"));
    expect(quick).toMatchObject({ player: 0, windowKind: "open" });
    const quickResult = applyLuaRestoreResponse(restored, quick!);
    expect(quickResult.ok, quickResult.error).toBe(true);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(quickResult.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(quickResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(quickResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(quickResult.legalActions);

    const staleQuick = applyLuaRestoreResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(staleQuick.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleQuick.legalActions);

    const finalPass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(finalPass).toBeDefined();
    expect(applyLuaRestoreResponse(restored, finalPass!).ok).toBe(true);
    expect(restored.host.messages).toEqual(["restored open fast source resolved", "restored open fast quick resolved"]);
  });
});
