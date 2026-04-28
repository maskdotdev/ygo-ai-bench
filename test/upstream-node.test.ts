import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyResponse, createCardReader, createDuel, createUpstreamSourceConfig, getDuelLegalActions, loadDecks, normalizeCdbRows, startDuel } from "../src/engine/index.js";
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
});
