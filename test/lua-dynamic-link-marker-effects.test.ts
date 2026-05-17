import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";

describe("Lua dynamic Link marker effects", () => {
  it("uses EFFECT_CHANGE_LINKMARKER for linked zones and linked groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Dynamic Marker Link", kind: "extra", typeFlags: 0x4000001, level: 2, linkMarkers: 0 },
      { code: "200", name: "Pointed Monster", kind: "monster", level: 4 },
    ];
    const session = createStartedSession(cards, { main: ["200"], extra: ["100"] });
    placeMonster(session, "100", 0);
    placeMonster(session, "200", 1);
    const host = createLuaScriptHost(session, { readScript: dynamicMarkerScript });

    const before = host.loadScript(
      `
      local link=Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local target=Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Debug.Message("before dynamic markers " .. link:GetLinkMarker() .. "/" .. link:GetLinkedZone(0) .. "/" .. Duel.GetLinkedZone(0) .. "/" .. tostring(link:IsLinked()) .. "/" .. tostring(target:IsLinked()))
      `,
      "before-dynamic-markers.lua",
    );
    expect(before.ok, before.error).toBe(true);
    expect(host.messages).toContain("before dynamic markers 0/0/0/false/false");

    expect(host.loadCardScript(100, { readScript: dynamicMarkerScript }).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const after = host.loadScript(
      `
      local link=Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local target=Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      local linked_group=link:GetLinkedGroup()
      Debug.Message("after dynamic markers " .. link:GetLinkMarker() .. "/" .. link:GetLinkedZone(0) .. "/" .. Duel.GetLinkedZone(0) .. "/" .. Duel.GetZoneWithLinkedCount(1,0) .. "/" .. linked_group:GetCount() .. "/" .. tostring(linked_group:IsContains(target)) .. "/" .. tostring(link:IsLinked()) .. "/" .. tostring(target:IsLinked()))
      `,
      "after-dynamic-markers.lua",
    );
    expect(after.ok, after.error).toBe(true);
    expect(host.messages).toContain("after dynamic markers 32/131074/131074/2/1/true/true/true");
  });

  it("uses changed Link markers for co-linked checks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Dynamic Co-Link Source", kind: "extra", typeFlags: 0x4000001, level: 2, linkMarkers: 0 },
      { code: "200", name: "Left Marker Link", kind: "extra", typeFlags: 0x4000001, level: 2, linkMarkers: 0x8 },
    ];
    const session = createStartedSession(cards, { main: [], extra: ["100", "200"] });
    placeMonster(session, "100", 0);
    placeMonster(session, "200", 1);
    const host = createLuaScriptHost(session, { readScript: dynamicMarkerScript });

    const before = host.loadScript(
      `
      local source=Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local target=Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Debug.Message("before dynamic colink " .. tostring(source:IsCoLinked()) .. "/" .. tostring(target:IsCoLinked()))
      `,
      "before-dynamic-colink.lua",
    );
    expect(before.ok, before.error).toBe(true);
    expect(host.messages).toContain("before dynamic colink false/false");

    expect(host.loadCardScript(100, { readScript: dynamicMarkerScript }).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const after = host.loadScript(
      `
      local source=Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local target=Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Debug.Message("after dynamic colink " .. tostring(source:IsCoLinked()) .. "/" .. tostring(target:IsCoLinked()) .. "/" .. source:GetLinkedZone(0) .. "/" .. target:GetLinkedZone(0))
      `,
      "after-dynamic-colink.lua",
    );
    expect(after.ok, after.error).toBe(true);
    expect(host.messages).toContain("after dynamic colink true/true/131074/65537");
  });

  it("uses additive and removal Link marker effects for linked groups", () => {
    const cards: DuelCardData[] = [
      { code: "300", name: "Add Remove Marker Link", kind: "extra", typeFlags: 0x4000001, level: 2, linkMarkers: 0x20 },
      { code: "401", name: "Left Pointed Monster", kind: "monster", level: 4 },
      { code: "402", name: "Right Pointed Monster", kind: "monster", level: 4 },
    ];
    const session = createStartedSession(cards, { main: ["401", "402"], extra: ["300"] });
    placeMonster(session, "401", 0);
    placeMonster(session, "300", 1);
    placeMonster(session, "402", 2);
    const host = createLuaScriptHost(session, { readScript: dynamicMarkerScript });

    const before = host.loadScript(
      `
      local source=Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Debug.Message("before add remove markers " .. source:GetLinkMarker() .. "/" .. source:GetLinkedZone(0))
      `,
      "before-add-remove-markers.lua",
    );
    expect(before.ok, before.error).toBe(true);
    expect(host.messages).toContain("before add remove markers 32/262148");

    expect(host.loadCardScript(300, { readScript: dynamicMarkerScript }).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const after = host.loadScript(
      `
      local left=Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local source=Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      local right=Duel.GetFieldCard(0, LOCATION_MZONE, 2)
      local linked_group=source:GetLinkedGroup()
      Debug.Message("after add remove markers " .. source:GetLinkMarker() .. "/" .. source:GetLinkedZone(0) .. "/" .. linked_group:GetCount() .. "/" .. tostring(linked_group:IsContains(left)) .. "/" .. tostring(linked_group:IsContains(right)))
      `,
      "after-add-remove-markers.lua",
    );
    expect(after.ok, after.error).toBe(true);
    expect(host.messages).toContain("after add remove markers 8/65537/1/true/false");
  });
});

function createStartedSession(cards: DuelCardData[], deck: { main: string[]; extra?: string[] }): DuelSession {
  const session = createDuel({ seed: 425, startingHandSize: deck.main.length, cardReader: createCardReader(cards) });
  loadDecks(session, { 0: deck, 1: { main: [] } });
  startDuel(session);
  return session;
}

function placeMonster(session: DuelSession, code: string, sequence: number): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  if (!card) throw new Error(`Expected card ${code}`);
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", 0);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function dynamicMarkerScript(name: string): string | undefined {
  if (name === "c100.lua") {
    return `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CHANGE_LINKMARKER)
        e:SetValue(32)
        c:RegisterEffect(e)
      end
    `;
  }
  if (name === "c300.lua") {
    return `
      c300={}
      function c300.initial_effect(c)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_SINGLE)
        e1:SetCode(EFFECT_ADD_LINKMARKER)
        e1:SetValue(8)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_SINGLE)
        e2:SetCode(EFFECT_REMOVE_LINKMARKER)
        e2:SetValue(32)
        c:RegisterEffect(e2)
      end
    `;
  }
  return undefined;
}
