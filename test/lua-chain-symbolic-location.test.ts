import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua symbolic chain locations", () => {
  it("exposes Extra Monster Zone triggering locations symbolically through chain info", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Symbolic Chain Source", kind: "monster" },
      { code: "400", name: "Symbolic Chain Inspector", kind: "monster" },
    ];
    const session = createDuel({ seed: 248, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeDefined();
    const moved = moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    moved.sequence = 5;
    moved.faceUp = true;
    moved.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetOperation(function(e,c)
          Debug.Message("symbolic source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          local tc=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_CARD)
          local loc,sym,seq=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_LOCATION, CHAININFO_TRIGGERING_LOCATION_SYMBOLIC, CHAININFO_TRIGGERING_SEQUENCE)
          Debug.Message("symbolic chain location " .. loc .. "/" .. sym .. "/" .. seq .. "/" .. tostring(sym==LOCATION_EMZONE) .. "/" .. tostring(tc:IsLocation(LOCATION_MZONE)) .. "/" .. tostring(tc:IsLocation(LOCATION_MMZONE)))
          return sym==LOCATION_EMZONE and tc:IsLocation(LOCATION_MZONE)
        end)
        e:SetOperation(function(e,c)
          Debug.Message("symbolic inspector resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "symbolic-chain-location.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    activateFirstEffect(session, 0, source!.uid);
    activateFirstEffect(session, 1);
    passChainIfAvailable(session);
    passChainIfAvailable(session);
    expect(host.messages).toContain("symbolic chain location 4/4096/5/true/true/false");
    expect(host.messages).toContain("symbolic inspector resolved");
    expect(host.messages).toContain("symbolic source resolved");
  });

  it("exposes spell/trap triggering locations symbolically through chain info", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Symbolic Spell Source", kind: "spell" },
      { code: "400", name: "Symbolic Spell Inspector", kind: "monster" },
    ];
    const session = createDuel({ seed: 249, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeDefined();
    const moved = moveDuelCard(session.state, source!.uid, "spellTrapZone", 0);
    moved.sequence = 2;
    moved.faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_SZONE)
        e:SetOperation(function(e,c)
          Debug.Message("symbolic spell source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          local loc,sym,seq=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_LOCATION, CHAININFO_TRIGGERING_LOCATION_SYMBOLIC, CHAININFO_TRIGGERING_SEQUENCE)
          Debug.Message("symbolic spell chain location " .. loc .. "/" .. sym .. "/" .. seq .. "/" .. tostring(sym==LOCATION_STZONE))
          return sym==LOCATION_STZONE
        end)
        e:SetOperation(function(e,c)
          Debug.Message("symbolic spell inspector resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "symbolic-spell-chain-location.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    activateFirstEffect(session, 0, source!.uid);
    activateFirstEffect(session, 1);
    passChainIfAvailable(session);
    passChainIfAvailable(session);
    expect(host.messages).toContain("symbolic spell chain location 8/1024/2/true");
    expect(host.messages).toContain("symbolic spell inspector resolved");
    expect(host.messages).toContain("symbolic spell source resolved");
  });

  it("exposes field and Pendulum zone triggering locations symbolically through chain info", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Symbolic Field Source", kind: "spell", typeFlags: 0x80002 },
      { code: "200", name: "Symbolic Pendulum Source", kind: "monster", typeFlags: 0x1000001, leftScale: 1, rightScale: 1 },
      { code: "400", name: "Symbolic Zone Inspector", kind: "monster" },
    ];
    const session = createDuel({ seed: 250, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const field = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const pendulum = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(field).toBeDefined();
    expect(pendulum).toBeDefined();
    moveDuelCard(session.state, field!.uid, "spellTrapZone", 0).faceUp = true;
    const movedPendulum = moveDuelCard(session.state, pendulum!.uid, "spellTrapZone", 0);
    movedPendulum.sequence = 0;
    movedPendulum.faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_FZONE)
        e:SetOperation(function(e,c)
          Debug.Message("symbolic field source resolved")
        end)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_PZONE)
        e:SetOperation(function(e,c)
          Debug.Message("symbolic pendulum source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          local tc=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_CARD)
          local loc,sym,seq=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_LOCATION, CHAININFO_TRIGGERING_LOCATION_SYMBOLIC, CHAININFO_TRIGGERING_SEQUENCE)
          Debug.Message("symbolic special chain location " .. tc:GetCode() .. "/" .. loc .. "/" .. sym .. "/" .. seq .. "/" .. tostring(tc:IsLocation(sym)))
          return sym==LOCATION_FZONE or sym==LOCATION_PZONE
        end)
        e:SetOperation(function(e,c)
          Debug.Message("symbolic zone inspector resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "symbolic-field-pendulum-chain-location.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    activateFirstEffect(session, 0, field!.uid);
    activateFirstEffect(session, 1);
    passChainIfAvailable(session);
    passChainIfAvailable(session);
    activateFirstEffect(session, 0, pendulum!.uid);
    activateFirstEffect(session, 1);
    passChainIfAvailable(session);
    passChainIfAvailable(session);
    expect(host.messages).toContain("symbolic special chain location 100/8/256/0/true");
    expect(host.messages).toContain("symbolic special chain location 200/8/512/0/true");
    expect(host.messages).toContain("symbolic zone inspector resolved");
    expect(host.messages).toContain("symbolic field source resolved");
    expect(host.messages).toContain("symbolic pendulum source resolved");
  });
});

function activateFirstEffect(session: ReturnType<typeof createDuel>, player: 0 | 1, uid?: string): void {
  const action = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateEffect" && (uid === undefined || candidate.uid === uid));
  expect(action).toBeDefined();
  expect(applyResponse(session, action!).ok).toBe(true);
}

function passChainIfAvailable(session: ReturnType<typeof createDuel>): boolean {
  const player = session.state.waitingFor;
  if (player === undefined) return false;
  const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
  return Boolean(pass && applyResponse(session, pass).ok);
}
