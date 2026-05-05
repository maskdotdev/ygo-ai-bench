import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua chain event helpers", () => {
  it("lets Lua scripts raise adjust triggers instantly", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Adjust Source", kind: "monster" },
      { code: "200", name: "Adjust Event Card", kind: "monster" },
    ];
    const session = createDuel({ seed: 96, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_ADJUST)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          local tc=eg:GetFirst()
          Debug.Message("adjust resolved " .. tostring(tc and tc:GetCode()))
        end)
        c:RegisterEffect(e)
      end
      `,
      "adjust-instantly.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const adjustResult = host.loadScript(
      `
      local event_card=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.AdjustInstantly(event_card)
      Debug.Message("adjust queued")
      `,
      "adjust-instantly-run.lua",
    );

    expect(adjustResult.ok, adjustResult.error).toBe(true);
    expect(host.messages).toContain("adjust queued");
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "adjust" }));
    expect(session.state.log).toContainEqual(expect.objectContaining({ action: "adjust", detail: "Instant adjust" }));

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(host.messages).toContain("adjust resolved 200");
  });

  it("lets Lua scripts request a generic readjust pass", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Readjust Source", kind: "monster" }];
    const session = createDuel({ seed: 167, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.Readjust()
      Debug.Message("readjust event " .. tostring(Duel.CheckEvent(EVENT_ADJUST)))
      `,
      "readjust.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("readjust event true");
    expect(session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "adjust" }));
    expect(session.state.log).toContainEqual(expect.objectContaining({ action: "adjust", detail: "Readjust" }));
  });

  it("queues Lua chain-end triggers after a chain fully resolves", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Starter", kind: "monster" },
      { code: "200", name: "Chain End Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 97, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp) Debug.Message("starter resolved") end)
        c:RegisterEffect(e)
      end
      `;
        }
        if (name === "c200.lua") {
          return `

      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_CHAIN_END)
        e:SetRange(LOCATION_HAND)
        e:SetCountLimit(1)
        e:SetOperation(function(e,tp) Debug.Message("chain end resolved") end)
        c:RegisterEffect(e)
      end
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const starterScript = host.loadCardScript(100, source);
    const watcherScript = host.loadCardScript(200, source);

    expect(starterScript.ok, starterScript.error).toBe(true);
    expect(watcherScript.ok, watcherScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const starter = session.state.cards.find((card) => card.code === "100");
    expect(starter).toBeDefined();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === starter!.uid);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toContain("starter resolved");
    expect(session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "chainEnded", eventCode: 1026 }));
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["chainEnded"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1026 });
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.loadedScripts).toEqual([{ ok: true, name: "c100.lua" }, { ok: true, name: "c200.lua" }]);
    expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const response = applyLuaRestoreResponse(restored, trigger!);
    expect(response.ok).toBe(true);
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
    expect(restored.host.messages).toContain("chain end resolved");
  });

  it("lets Lua operations mark break effect boundaries", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Break Source", kind: "monster" }];
    const session = createDuel({ seed: 86, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("before break")
          Duel.BreakEffect()
          Debug.Message("after break")
        end)
        c:RegisterEffect(e)
      end
      `,
      "break-effect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(host.messages).toContain("before break");
    expect(host.messages).toContain("after break");
    const breakLog = session.state.log.find((entry) => entry.action === "breakEffect");
    expect(breakLog).toMatchObject({ player: 0, detail: "Effect operation break" });
    expect(session.state.log.findIndex((entry) => entry.action === "activate")).toBeLessThan(session.state.log.findIndex((entry) => entry.action === "breakEffect"));
  });

  it("lets Lua scripts check whether a field source relates to its resolving chain link", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Chain Relation Source", kind: "monster" }];
    const session = createDuel({ seed: 206, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "100")!;
    source.location = "monsterZone";
    source.sequence = 0;
    source.position = "faceUpAttack";
    source.faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetOperation(function(e,tp)
          local c=e:GetHandler()
          Debug.Message("chain relation before " .. tostring(c:IsRelateToChain(0)))
          Duel.SendtoGrave(c, REASON_EFFECT)
          Debug.Message("chain relation after " .. tostring(c:IsRelateToChain(0)))
        end)
        c:RegisterEffect(e)
      end
      `,
      "chain-relation.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(host.messages).toContain("chain relation before true");
    expect(host.messages).toContain("chain relation after false");
  });
});
