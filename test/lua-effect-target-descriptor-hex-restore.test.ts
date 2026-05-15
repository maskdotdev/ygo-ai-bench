import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua effect target descriptor hex restore", () => {
  it("restores Special Summon limits that use hex LOCATION_EXTRA", () => {
    const lockCode = "110";
    const extraCode = "210";
    const handCode = "310";
    const cards: DuelCardData[] = [
      { code: lockCode, name: "Hex Extra Summon Lock", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: extraCode, name: "Hex Locked Extra Monster", kind: "extra", typeFlags: 0x41, level: 6, attack: 2000, defense: 1500 },
      { code: handCode, name: "Hex Allowed Hand Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 110, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lockCode, handCode], extra: [extraCode] }, 1: { main: [] } });
    startDuel(session);

    const lock = requireCard(session, lockCode);
    const extra = requireCard(session, extraCode);
    const hand = requireCard(session, handCode);
    moveDuelCard(session.state, lock.uid, "monsterZone", 0).position = "faceUpAttack";
    lock.faceUp = true;
    moveDuelCard(session.state, hand.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${lockCode}.lua`) return lockScript();
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(Number(lockCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === lock.uid && effect.code === 22)).toMatchObject({
      event: "continuous",
      targetRange: [1, 0],
      luaTargetDescriptor: "special-summon-limit:extra",
    });

    const probe = restored.host.loadScript(
      `
      local extra=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${extraCode}),0,LOCATION_EXTRA,0,nil)
      local hand=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("hex extra special " .. Duel.SpecialSummon(extra,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("hex hand special " .. Duel.SpecialSummon(hand,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "hex-extra-special-summon-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("hex extra special 0");
    expect(restored.host.messages).toContain("hex hand special 1");
    expect(restored.session.state.cards.find((card) => card.uid === extra.uid)).toMatchObject({ location: "extraDeck" });
    expect(restored.session.state.cards.find((card) => card.uid === hand.uid)).toMatchObject({ location: "monsterZone" });
  });
});

function lockScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_FIELD)
      e:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e:SetRange(LOCATION_MZONE)
      e:SetTargetRange(1,0)
      e:SetTarget(function(e,c) return c:IsLocation(0x40) end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
