import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createCardReader, createUpstreamSourceConfig, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Node upstream operation and battle Lua effects", () => {
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
          Debug.Message("destroyed again " .. Duel.Destroy(dg, REASON_EFFECT))
          Debug.Message("removed " .. Duel.Remove(rg, POS_FACEUP_ATTACK, REASON_EFFECT))
          Debug.Message("removed again " .. Duel.Remove(rg, POS_FACEUP_ATTACK, REASON_EFFECT))
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
    expect(host.messages).toContain("destroyed again 0");
    expect(host.messages).toContain("removed 1");
    expect(host.messages).toContain("removed again 0");
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

  it("lets Lua operations read and modify life points", () => {
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
          Debug.Message("lp before " .. Duel.GetLP(1))
          Debug.Message("damage " .. Duel.Damage(1, 1200, REASON_EFFECT))
          Debug.Message("delayed damage " .. Duel.Damage(0, 100, REASON_EFFECT, true))
          Duel.RDComplete()
          Debug.Message("lp after damage " .. Duel.GetLP(1))
          Debug.Message("recover " .. Duel.Recover(1, 300, REASON_EFFECT))
          Duel.SetLP(1, 250)
          Debug.Message("can cost 200 " .. tostring(Duel.CheckLPCost(1, 200)))
          Debug.Message("can cost 250 " .. tostring(Duel.CheckLPCost(1, 250)))
          Duel.PayLPCost(1, 200)
          Debug.Message("lp after cost " .. Duel.GetLP(1))
          Debug.Message("lp final " .. Duel.GetLP(1))
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
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
    expect(result.state.players[0].lifePoints).toBe(7900);
    expect(result.state.players[1].lifePoints).toBe(50);
    expect(host.messages).toEqual(expect.arrayContaining(["lp before 8000", "damage 1200", "delayed damage 100", "lp after damage 6800", "recover 300", "can cost 200 true", "can cost 250 false", "lp after cost 50", "lp final 50"]));
  });

  it("lets Lua attack triggers inspect the attacker and attack target", () => {
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
        e:SetCode(EVENT_ATTACK_ANNOUNCE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          local a = Duel.GetAttacker()
          local t = Duel.GetAttackTarget()
          Debug.Message("attack " .. a:GetCode() .. " -> " .. t:GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows(
      [
        { id: 100, type: 1, atk: 1800, def: 1200 },
        { id: 300, type: 1, atk: 0, def: 0 },
        { id: 400, type: 1, atk: 1000, def: 1000 },
      ],
      [],
    );
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "100"] },
      1: { main: ["300", "400"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    expect(host.loadCardScript(300, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeTruthy();
    expect(applyResponse(session, battle!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.targetUid === target!.uid);
    expect(attack).toBeTruthy();
    const attackResult = applyResponse(session, attack!);
    expect(attackResult.ok).toBe(true);
    expect(attackResult.state.pendingTriggers).toHaveLength(1);

    const trigger = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("attack 100 -> 400");
  });

  it("lets Lua effects change battle position and trigger position-change effects", () => {
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
        e:SetRange(LOCATION_MZONE)
        e:SetOperation(function(e,c)
          Debug.Message("attack before " .. tostring(c:IsAttackPos()))
          Debug.Message("changed " .. Duel.ChangePosition(c, POS_FACEUP_DEFENSE))
          Debug.Message("defense after " .. tostring(c:IsDefensePos()))
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "script", "c300.lua"),
      `
      c300 = {}
      c300.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_CHANGE_POS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("position trigger resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1, atk: 1800, def: 1200 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const monster = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(monster).toBeTruthy();
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.loadCardScript(300, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeTruthy();
    const activation = applyResponse(session, action!);

    expect(activation.ok).toBe(true);
    expect(activation.state.cards.find((card) => card.uid === monster!.uid)?.position).toBe("faceUpDefense");
    expect(activation.state.pendingTriggers).toHaveLength(1);
    expect(host.messages).toEqual(expect.arrayContaining(["attack before true", "changed 1", "defense after true"]));

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("position trigger resolved");
  });

  it("lets Lua flip triggers inspect face-down and position state", () => {
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
        e:SetCode(EVENT_FLIP)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("facedown source " .. tostring(c:IsFacedown()))
          local g = Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsPosition, POS_FACEUP_ATTACK), 0, LOCATION_MZONE, 0, nil)
          Debug.Message("faceup attackers " .. g:GetCount())
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1, atk: 1800, def: 1200 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const monster = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(monster).toBeTruthy();
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0).position = "faceDownDefense";
    session.state.cards.find((card) => card.uid === monster!.uid)!.faceUp = false;

    const host = createLuaScriptHost(session);
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    expect(host.loadCardScript(300, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "flipSummon" && candidate.uid === monster!.uid);
    expect(action).toBeTruthy();
    const flip = applyResponse(session, action!);
    expect(flip.ok).toBe(true);
    expect(flip.state.pendingTriggers).toHaveLength(1);

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(host.messages).toEqual(expect.arrayContaining(["facedown source true", "faceup attackers 1"]));
  });
});
