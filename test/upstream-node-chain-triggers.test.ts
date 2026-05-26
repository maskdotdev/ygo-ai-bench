import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createCardReader, createUpstreamSourceConfig, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Node upstream chain and trigger Lua effects", () => {
  it("lets Lua operations move cards through Duel helpers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c100.lua"),
      `
      c100 = {}
      c100.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          local g = Duel.GetMatchingGroup(nil, 0, LOCATION_HAND, 0, c)
          Debug.Message("hand group count " .. g:GetCount())
          local tc = g:GetFirst()
          if tc and tc:IsCode(300) then
            Duel.SendtoGrave(tc, REASON_EFFECT)
          end
          Duel.SpecialSummon(c, 0, 0, 0, false, false, POS_FACEUP_ATTACK)
          Debug.Message("self faceup " .. tostring(c:IsFaceup()))
          Debug.Message("self in mzone " .. tostring(c:IsLocation(LOCATION_MZONE)))
          Debug.Message("self controller " .. tostring(c:IsControler(0)))
          Debug.Message("self able grave " .. tostring(c:IsAbleToGrave()))
          Debug.Message("self able hand " .. tostring(c:IsAbleToHand()))
          Debug.Message("self able deck " .. tostring(c:IsAbleToDeck()))
          Debug.Message("self able remove " .. tostring(c:IsAbleToRemove()))
          Debug.Message("self able extra " .. tostring(c:IsAbleToExtra()))
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200", "400"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("hand group count 1");
    expect(host.messages).toEqual(expect.arrayContaining(["self faceup true", "self in mzone true", "self controller true", "self able grave true"]));
    expect(host.messages).toEqual(expect.arrayContaining(["self able hand true", "self able deck true", "self able remove true", "self able extra false"]));
    expect(result.state.cards.find((card) => card.code === "100")?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.code === "300")?.location).toBe("graveyard");
  });

  it("supports filtered Lua selection helpers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c100.lua"),
      `
      c100 = {}
      c100.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          local ct = Duel.GetMatchingGroupCount(aux.FilterBoolFunction(Card.IsSetCard, 0x123), 0, LOCATION_HAND, 0, c)
          Debug.Message("matching set count " .. ct)
          if Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, c) then
            Debug.Message("existing code found")
          end
          Debug.Message("open monster zones " .. Duel.GetLocationCount(0, LOCATION_MZONE))
          local g = Duel.SelectTarget(0, aux.FilterBoolFunction(Card.IsSetCard, 0x123), 0, LOCATION_HAND, 0, 1, 1, c)
          Debug.Message("selected set count " .. g:GetCount())
          Duel.SendtoGrave(g, REASON_EFFECT)
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows(
      [
        { id: 100, type: 1 },
        { id: 300, type: 1, setcode: 0x123 },
        { id: 400, type: 1 },
      ],
      [],
    );
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("matching set count 1");
    expect(host.messages).toContain("existing code found");
    expect(host.messages).toContain("open monster zones 5");
    expect(host.messages).toContain("selected set count 1");
    expect(result.state.cards.find((card) => card.code === "300")?.location).toBe("graveyard");
  });

  it("uses Lua condition, cost, and target callbacks during activation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c100.lua"),
      `
      c100 = {}
      c100.initial_effect = function(c)
        local hidden = Effect.CreateEffect(c)
        hidden:SetType(EFFECT_TYPE_IGNITION)
        hidden:SetRange(LOCATION_HAND)
        hidden:SetCondition(function(e,c)
          return false
        end)
        hidden:SetOperation(function(e,c)
          Debug.Message("hidden should not resolve")
        end)
        c:RegisterEffect(hidden)

        local active = Effect.CreateEffect(c)
        active:SetType(EFFECT_TYPE_IGNITION)
        active:SetRange(LOCATION_HAND)
        active:SetCondition(function(e,c)
          return Duel.GetTurnPlayer() == 0
        end)
        active:SetCost(function(e,c)
          local g = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, c)
          Debug.Message("cost count " .. g:GetCount())
          Duel.SendtoGrave(g, REASON_EFFECT)
          return true
        end)
        active:SetTarget(function(e,c)
          Debug.Message("target checked")
          return true
        end)
        active:SetOperation(function(e,c)
          Debug.Message("condition cost target operation resolved")
        end)
        c:RegisterEffect(active)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const actions = getDuelLegalActions(session, 0).filter((candidate) => candidate.type === "activateEffect");
    expect(actions).toHaveLength(1);
    const result = applyResponse(session, actions[0]!);

    expect(result.ok).toBe(true);
    expect(host.messages).toEqual(expect.arrayContaining(["cost count 1", "target checked", "condition cost target operation resolved"]));
    expect(host.messages).not.toContain("hidden should not resolve");
    expect(result.state.cards.find((card) => card.code === "300")?.location).toBe("graveyard");
  });

  it("fires Lua trigger effects after a normal summon", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c300.lua"),
      `
      c300 = {}
      c300.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("summon trigger resolved")
          Duel.SendtoGrave(c, REASON_EFFECT)
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    expect(host.loadCardScript(300, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.label.includes("Card 100"));
    expect(summon).toBeTruthy();
    const summonResult = applyResponse(session, summon!);

    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.pendingTriggers).toHaveLength(1);
    expect(summonResult.state.cards.find((card) => card.code === "300")?.location).toBe("hand");
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("summon trigger resolved");
    expect(result.state.cards.find((card) => card.code === "300")?.location).toBe("graveyard");
    expect(result.state.log.some((entry) => entry.action === "trigger")).toBe(true);
  });

  it("maps Lua special summon trigger events", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c100.lua"),
      `
      c100 = {}
      c100.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          local g = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, c)
          Duel.SpecialSummon(g, 0, 0, 0, false, false, POS_FACEUP_ATTACK)
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "script", "c400.lua"),
      `
      c400 = {}
      c400.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SPSUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("special summon trigger resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }, { id: 500, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.loadCardScript(400, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeTruthy();
    const activation = applyResponse(session, action!);
    expect(activation.ok).toBe(true);
    expect(activation.state.pendingTriggers).toHaveLength(1);

    const trigger = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("special summon trigger resolved");
  });

  it("maps Lua sent-to-graveyard trigger events", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c100.lua"),
      `
      c100 = {}
      c100.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          local g = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, c)
          Duel.SendtoGrave(g, REASON_EFFECT)
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "script", "c400.lua"),
      `
      c400 = {}
      c400.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_TO_GRAVE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("graveyard trigger resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }, { id: 500, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.loadCardScript(400, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeTruthy();
    const activation = applyResponse(session, action!);
    expect(activation.ok).toBe(true);
    expect(activation.state.pendingTriggers).toHaveLength(1);

    const trigger = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("graveyard trigger resolved");
  });

  it("lets Lua quick effects negate pending chain links", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c100.lua"),
      `
      c100 = {}
      c100.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("negated lua operation should not resolve")
          Duel.SendtoGrave(c, REASON_EFFECT)
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "script", "c400.lua"),
      `
      c400 = {}
      c400.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("chain depth " .. Duel.GetCurrentChain())
          if Duel.NegateActivation() then
            Debug.Message("lua negation resolved")
          end
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }, { id: 500, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.loadCardScript(400, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(activation).toBeTruthy();
    const opened = applyResponse(session, activation!);
    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.legalActions).toEqual(getDuelLegalActions(session, 1));
    expect(opened.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 1));
    expect(opened.legalActionGroups.flatMap((group) => group.actions)).toEqual(opened.legalActions);

    const response = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(response).toBeTruthy();
    const chained = applyResponse(session, response!);

    expect(chained.ok).toBe(true);
    expect(chained.state.chain).toHaveLength(2);
    expect(chained.state.waitingFor).toBe(1);
    expect(chained.legalActions).toEqual(getDuelLegalActions(session, 1));
    expect(chained.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 1));
    expect(chained.legalActionGroups.flatMap((group) => group.actions)).toEqual(chained.legalActions);

    const pass = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeTruthy();
    const result = applyResponse(session, pass!);

    expect(result.ok).toBe(true);
    expect(result.state.chain).toHaveLength(0);
    expect(result.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.state.cards.find((card) => card.code === "100")?.location).toBe("hand");
    expect(host.messages).toContain("chain depth 2");
    expect(host.messages).toContain("lua negation resolved");
    expect(host.messages).not.toContain("negated lua operation should not resolve");
  });

  it("persists Lua selected targets until chain resolution", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c100.lua"),
      `
      c100 = {}
      c100.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,c)
          local g = Duel.SelectTarget(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, 0, LOCATION_HAND, 1, 1, c)
          Debug.Message("lua target count " .. g:GetCount())
          return g:GetCount() == 1
        end)
        e:SetOperation(function(e,c)
          local tc = Duel.GetFirstTarget()
          if tc then
            Debug.Message("lua target persisted " .. tc:GetCode())
            Duel.SendtoGrave(tc, REASON_EFFECT)
          end
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "script", "c400.lua"),
      `
      c400 = {}
      c400.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("lua response before target")
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }, { id: 500, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.loadCardScript(400, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.label.includes("Card 100"));
    expect(activation).toBeTruthy();
    const opened = applyResponse(session, activation!);
    expect(opened.ok).toBe(true);
    expect(opened.state.chain[0]?.targetUids).toHaveLength(1);

    const response = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(response).toBeTruthy();
    const chained = applyResponse(session, response!);

    expect(chained.ok).toBe(true);
    expect(chained.state.chain).toHaveLength(2);
    expect(chained.state.waitingFor).toBe(1);
    expect(chained.state.cards.find((card) => card.code === "500")?.location).toBe("hand");

    const pass = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeTruthy();
    const result = applyResponse(session, pass!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.code === "500")?.location).toBe("graveyard");
    expect(host.messages).toContain("lua target count 1");
    expect(host.messages).toContain("lua response before target");
    expect(host.messages).toContain("lua target persisted 500");
  });

});
