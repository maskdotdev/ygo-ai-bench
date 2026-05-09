import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

function placeOpponentMonster(session: ReturnType<typeof createDuel>, code: string): void {
  const card = session.state.cards.find((candidate) => candidate.controller === 1 && candidate.code === code);
  expect(card).toBeTruthy();
  moveDuelCard(session.state, card!.uid, "monsterZone", 1);
  card!.faceUp = true;
  card!.position = "faceUpAttack";
}

describe("Lua operation immunity stat updates", () => {
  it("blocks active-effect stat updates of immune cards unless the effect ignores immunity", () => {
    const cards: DuelCardData[] = [
      { code: "160", name: "Stat Update Source", kind: "monster" },
      { code: "161", name: "Ignore Stat Update Source", kind: "monster" },
      { code: "270", name: "Immune Stat Target", kind: "monster", typeFlags: 0x21, attack: 2000, defense: 2000, level: 4 },
      { code: "271", name: "Immune Rank Target", kind: "extra", typeFlags: 0x800001, attack: 2000, defense: 2000, level: 4 },
      { code: "272", name: "Immune Link Target", kind: "extra", typeFlags: 0x4000001, attack: 2000, level: 2 },
      { code: "273", name: "Immune Scale Target", kind: "monster", typeFlags: 0x1000001, attack: 1000, defense: 1000, level: 4, leftScale: 4, rightScale: 4 },
      { code: "370", name: "Open Stat Target", kind: "monster", typeFlags: 0x21, attack: 2000, defense: 2000, level: 4 },
    ];
    const session = createDuel({ seed: 224, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["160", "161"] },
      1: { main: ["270", "272", "273", "370"], extra: ["271"] },
    });
    startDuel(session);
    for (const code of ["270", "271", "272", "273", "370"]) placeOpponentMonster(session, code);

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      local function pick(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      end
      local function register_immune(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_IMMUNE_EFFECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(function(e,te)
          return te:GetOwnerPlayer()==0
        end)
        c:RegisterEffect(e)
      end
      c160={}
      function c160.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local stat=pick(270)
          Debug.Message("protected attack " .. stat:UpdateAttack(300) .. "/" .. stat:GetAttack())
          Debug.Message("protected defense " .. stat:UpdateDefense(-500) .. "/" .. stat:GetDefense())
          Debug.Message("protected level " .. stat:UpdateLevel(1) .. "/" .. stat:GetLevel())
          local rank=pick(271)
          Debug.Message("protected rank " .. rank:UpdateRank(2) .. "/" .. rank:GetRank())
          local link=pick(272)
          Debug.Message("protected link " .. link:UpdateLink(1) .. "/" .. link:GetLink())
          local scale=pick(273)
          Debug.Message("protected scale " .. scale:UpdateScale(2) .. "/" .. scale:GetScale())
          local open=pick(370)
          Debug.Message("open attack " .. open:UpdateAttack(300) .. "/" .. open:GetAttack())
        end)
        c:RegisterEffect(e)
      end
      c161={}
      function c161.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local stat=pick(270)
          Debug.Message("ignore attack " .. stat:UpdateAttack(300) .. "/" .. stat:GetAttack())
          Debug.Message("ignore defense " .. stat:UpdateDefense(-500) .. "/" .. stat:GetDefense())
          Debug.Message("ignore level " .. stat:UpdateLevel(1) .. "/" .. stat:GetLevel())
          local rank=pick(271)
          Debug.Message("ignore rank " .. rank:UpdateRank(2) .. "/" .. rank:GetRank())
          local link=pick(272)
          Debug.Message("ignore link " .. link:UpdateLink(1) .. "/" .. link:GetLink())
          local scale=pick(273)
          Debug.Message("ignore scale " .. scale:UpdateScale(2) .. "/" .. scale:GetScale())
        end)
        c:RegisterEffect(e)
      end
      c270={initial_effect=register_immune}
      c271={initial_effect=register_immune}
      c272={initial_effect=register_immune}
      c273={initial_effect=register_immune}
      `,
      "operation-immunity-stat-updates.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(6);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "160");
    const ignoreSource = session.state.cards.find((card) => card.controller === 0 && card.code === "161");
    expect(source).toBeTruthy();
    expect(ignoreSource).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeTruthy();
    expect(applyResponse(session, action!).ok).toBe(true);

    for (const message of [
      "protected attack 0/2000",
      "protected defense 0/2000",
      "protected level 0/4",
      "protected rank 0/4",
      "protected link 0/2",
      "protected scale 0/4",
      "open attack 300/2300",
    ]) {
      expect(host.messages).toContain(message);
    }

    const ignoreAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === ignoreSource!.uid);
    expect(ignoreAction).toBeTruthy();
    expect(applyResponse(session, ignoreAction!).ok).toBe(true);

    for (const message of [
      "ignore attack 300/2300",
      "ignore defense -500/1500",
      "ignore level 1/5",
      "ignore rank 2/6",
      "ignore link 1/3",
      "ignore scale 2/6",
    ]) {
      expect(host.messages).toContain(message);
    }
  });
});
