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

describe("Lua operation immunity effect copying", () => {
  it("blocks CopyEffect onto immune receivers unless the active effect ignores immunity", () => {
    const cards: DuelCardData[] = [
      { code: "162", name: "Copy Effect Source", kind: "monster" },
      { code: "163", name: "Ignore Copy Effect Source", kind: "monster" },
      { code: "280", name: "Immune Copy Receiver", kind: "monster", typeFlags: 0x21, attack: 1000, defense: 1000, level: 4 },
      { code: "380", name: "Open Copy Receiver", kind: "monster", typeFlags: 0x21, attack: 1000, defense: 1000, level: 4 },
    ];
    const session = createDuel({ seed: 225, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["162", "163"] },
      1: { main: ["280", "380"] },
    });
    startDuel(session);
    placeOpponentMonster(session, "280");
    placeOpponentMonster(session, "380");

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      local function pick(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      end
      local function has_update(c)
        return tostring(c:IsHasEffect(EFFECT_UPDATE_ATTACK)~=nil)
      end
      c999={}
      function c999.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_UPDATE_ATTACK)
        e:SetValue(700)
        c:RegisterEffect(e)
      end
      c162={}
      function c162.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local protected=pick(280)
          local open=pick(380)
          Debug.Message("copy protected " .. protected:CopyEffect(999, RESET_EVENT|RESETS_STANDARD, 1) .. "/" .. has_update(protected))
          local open_copy=open:CopyEffect(999, RESET_EVENT|RESETS_STANDARD, 1)
          Debug.Message("copy open " .. tostring(open_copy>0) .. "/" .. has_update(open))
        end)
        c:RegisterEffect(e)
      end
      c163={}
      function c163.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local protected=pick(280)
          local copy_id=protected:CopyEffect(999, RESET_EVENT|RESETS_STANDARD, 1)
          Debug.Message("ignore copy protected " .. tostring(copy_id>0) .. "/" .. has_update(protected))
        end)
        c:RegisterEffect(e)
      end
      c280={}
      function c280.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_IMMUNE_EFFECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(function(e,te)
          return te:GetOwnerPlayer()==0
        end)
        c:RegisterEffect(e)
      end
      `,
      "operation-immunity-copy-effect.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "162");
    const ignoreSource = session.state.cards.find((card) => card.controller === 0 && card.code === "163");
    expect(source).toBeTruthy();
    expect(ignoreSource).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeTruthy();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toContain("copy protected 0/false");
    expect(host.messages).toContain("copy open true/true");

    const ignoreAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === ignoreSource!.uid);
    expect(ignoreAction).toBeTruthy();
    expect(applyResponse(session, ignoreAction!).ok).toBe(true);

    expect(host.messages).toContain("ignore copy protected true/true");
  });
});
