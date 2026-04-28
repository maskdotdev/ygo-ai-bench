import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyResponse, createCardReader, createDuel, createUpstreamSourceConfig, getDuelLegalActions, loadDecks, moveDuelCard, normalizeCdbRows, startDuel } from "../src/engine/index.js";
import { createLuaScriptHost } from "../src/engine/lua-host.js";
import { createUpstreamNodeWorkspace } from "../src/engine/upstream-node.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Node upstream workspace loader", () => {
  it("loads card scripts and banlists from a local upstream checkout shape", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(path.join(root, "script", "c100.lua"), "loaded_name = 'fixture script'\nDebug.Message(loaded_name)\n", "utf8");
    fs.writeFileSync(path.join(root, "lflist.conf"), "100 1\n200 0\n", "utf8");

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    expect(workspace.readCardScript(100)).toContain("fixture script");
    expect(workspace.readBanlist("lflist.conf")).toEqual([
      { code: "100", limit: 1 },
      { code: "200", limit: 0 },
    ]);

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadCardScript(100, workspace);

    expect(result).toEqual({ ok: true, name: "c100.lua" });
    expect(host.getGlobalString("loaded_name")).toBe("fixture script");
    expect(host.messages).toContain("fixture script");
  });

  it("registers a basic Lua ignition effect into the duel engine", () => {
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
        e:SetCountLimit(1)
        e:SetOperation(function(e,c)
          Debug.Message("lua ignition resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
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
    expect(host.messages).toContain("lua ignition resolved");
    expect(result.state.log.some((entry) => entry.detail.includes("Lua effect operation resolved"))).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect")).toBe(false);
  });

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

    const response = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(response).toBeTruthy();
    const result = applyResponse(session, response!);

    expect(result.ok).toBe(true);
    expect(result.state.chain).toHaveLength(0);
    expect(result.state.cards.find((card) => card.code === "100")?.location).toBe("hand");
    expect(host.messages).toContain("chain depth 1");
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
    const result = applyResponse(session, response!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.code === "500")?.location).toBe("graveyard");
    expect(host.messages).toContain("lua target count 1");
    expect(host.messages).toContain("lua response before target");
    expect(host.messages).toContain("lua target persisted 500");
  });

  it("lets Lua operations destroy and banish cards", () => {
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
          local dg = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, c)
          local rg = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, c)
          Debug.Message("destroyed " .. Duel.Destroy(dg, REASON_EFFECT))
          Debug.Message("removed " .. Duel.Remove(rg, POS_FACEUP_ATTACK, REASON_EFFECT))
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 300, type: 1 }, { id: 500, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
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
    expect(result.state.cards.find((card) => card.code === "300")?.location).toBe("graveyard");
    expect(result.state.cards.find((card) => card.code === "500")?.location).toBe("banished");
    expect(host.messages).toContain("destroyed 1");
    expect(host.messages).toContain("removed 1");
  });

  it("returns zero from Lua special summon when the monster zone is full", () => {
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
          Debug.Message("open zones " .. Duel.GetLocationCount(0, LOCATION_MZONE))
          Debug.Message("special summoned " .. Duel.SpecialSummon(g, 0, 0, 0, false, false, POS_FACEUP_ATTACK))
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }, { id: 500, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500", "500", "500", "500", "500"] },
      1: { main: ["400", "400", "400", "400", "400", "400", "400"] },
    });
    startDuel(session);

    const fillers = getDuelLegalActions(session, 0);
    expect(fillers.some((action) => action.type === "activateEffect")).toBe(false);
    const monsters = session.state.cards.filter((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    for (const card of monsters) moveDuelCard(session.state, card.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.code === "300")?.location).toBe("hand");
    expect(host.messages).toContain("open zones 0");
    expect(host.messages).toContain("special summoned 0");
  });
});
