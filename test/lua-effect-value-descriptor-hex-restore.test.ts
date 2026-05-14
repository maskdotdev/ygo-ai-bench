import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua effect value descriptor hex restore", () => {
  it("restores cannot-activate card activation predicates that use hex EFFECT_TYPE_ACTIVATE", () => {
    const lockCode = "100";
    const spellCode = "200";
    const monsterCode = "300";
    const cards: DuelCardData[] = [
      { code: lockCode, name: "Hex Activation Lock", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: spellCode, name: "Hex Locked Spell", kind: "spell", typeFlags: 0x2 },
      { code: monsterCode, name: "Hex Allowed Monster Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 109, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lockCode] }, 1: { main: [spellCode, monsterCode] } });
    startDuel(session);

    const lock = requireCard(session, lockCode);
    const spell = requireCard(session, spellCode);
    const monster = requireCard(session, monsterCode);
    moveDuelCard(session.state, lock.uid, "monsterZone", 0).position = "faceUpAttack";
    lock.faceUp = true;
    moveDuelCard(session.state, spell.uid, "hand", 1);
    moveDuelCard(session.state, monster.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${lockCode}.lua`) return lockScript();
        if (name === `c${spellCode}.lua`) return spellScript();
        if (name === `c${monsterCode}.lua`) return monsterScript();
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(Number(lockCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(spellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(monsterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === lock.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [0, 1],
      luaValueDescriptor: "cannot-activate:card-activation",
    });
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === spell.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === monster.uid)).toBe(true);
  });
});

function lockScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_FIELD)
      e:SetCode(EFFECT_CANNOT_ACTIVATE)
      e:SetRange(LOCATION_MZONE)
      e:SetTargetRange(0,1)
      e:SetValue(function(e,re) return re:IsHasType(0x10) end)
      c:RegisterEffect(e)
    end
  `;
}

function spellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("hex locked spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function monsterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("hex allowed monster resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
