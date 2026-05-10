import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";

type LinkSummonAction = Extract<ReturnType<typeof getDuelLegalActions>[number], { type: "linkSummon" }>;

describe("Lua dynamic Link stat effects", () => {
  it("uses EFFECT_CHANGE_LINK for Link Summon target ratings and Lua link checks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Changed Link Target", kind: "extra", typeFlags: 0x4000001, level: 1, linkMaterialMin: 2 },
      { code: "200", name: "Link-2 Material", kind: "extra", typeFlags: 0x4000001, level: 2 },
      { code: "300", name: "Normal Link Material", kind: "monster", level: 4 },
    ];
    const session = createStartedSession(cards, { main: ["200", "300"], extra: ["100"] });
    const target = requireCard(session, "100");
    const linkMaterial = moveToMonsterZone(session, "200");
    const normalMaterial = moveToMonsterZone(session, "300");
    expect(findLinkSummonAction(session, target.uid, [linkMaterial.uid, normalMaterial.uid])).toBeUndefined();

    const host = createLuaScriptHost(session, { readScript: dynamicLinkScript });
    expect(host.loadCardScript(100, { readScript: dynamicLinkScript }).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = findLinkSummonAction(session, target.uid, [linkMaterial.uid, normalMaterial.uid]);
    expect(action).toBeDefined();
    const result = host.loadScript(
      `
      local link=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode,100), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      local link_material=Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local normal_material=Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Debug.Message("change link target " .. link:GetLink() .. "/" .. tostring(link:IsLink(3)) .. "/" .. tostring(link:IsLinkAbove(3)) .. "/" .. tostring(link:IsLinkBelow(2)) .. "/" .. tostring(link_material:IsCanBeLinkMaterial(link)) .. "/" .. tostring(link:IsLinkSummonable(nil, Group.FromCards(link_material, normal_material), 2, 2)))
      `,
      "change-link-target.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("change link target 3/true/true/false/true/true");

    if (!action) throw new Error("Expected Link Summon action");
    expect(applyResponse(session, action).ok).toBe(true);
    expect(session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "monsterZone", summonType: "link" });
  });

  it("uses EFFECT_UPDATE_LINK for Link material ratings in core and Lua summon checks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Link-3 Target", kind: "extra", typeFlags: 0x4000001, level: 3, linkMaterialMin: 2 },
      { code: "200", name: "Updated Link Material", kind: "extra", typeFlags: 0x4000001, level: 1 },
      { code: "300", name: "Normal Link Material", kind: "monster", level: 4 },
    ];
    const session = createStartedSession(cards, { main: ["200", "300"], extra: ["100"] });
    const target = requireCard(session, "100");
    const linkMaterial = moveToMonsterZone(session, "200");
    const normalMaterial = moveToMonsterZone(session, "300");
    expect(findLinkSummonAction(session, target.uid, [linkMaterial.uid, normalMaterial.uid])).toBeUndefined();

    const host = createLuaScriptHost(session, { readScript: dynamicLinkScript });
    expect(host.loadCardScript(200, { readScript: dynamicLinkScript }).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = findLinkSummonAction(session, target.uid, [linkMaterial.uid, normalMaterial.uid]);
    expect(action).toBeDefined();
    const result = host.loadScript(
      `
      local link=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode,100), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      local link_material=Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local normal_material=Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Debug.Message("update link material " .. link_material:GetLink() .. "/" .. tostring(link_material:IsLink(2)) .. "/" .. tostring(link_material:IsLinkMonster()) .. "/" .. tostring(link:IsLinkSummonable(nil, Group.FromCards(link_material, normal_material), 2, 2)))
      `,
      "update-link-material.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("update link material 2/true/true/true");

    if (!action) throw new Error("Expected Link Summon action");
    expect(applyResponse(session, action).ok).toBe(true);
    expect(session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "monsterZone", summonType: "link" });
  });

  it("uses EFFECT_CHANGE_LINK_FINAL ahead of non-final Link changes", () => {
    const cards: DuelCardData[] = [
      { code: "400", name: "Final Link Target", kind: "extra", typeFlags: 0x4000001, level: 1, linkMaterialMin: 3 },
      { code: "501", name: "First Normal Material", kind: "monster", level: 4 },
      { code: "502", name: "Second Normal Material", kind: "monster", level: 4 },
      { code: "503", name: "Third Normal Material", kind: "monster", level: 4 },
    ];
    const session = createStartedSession(cards, { main: ["501", "502", "503"], extra: ["400"] });
    const target = requireCard(session, "400");
    const materials = ["501", "502", "503"].map((code) => moveToMonsterZone(session, code));
    expect(findLinkSummonAction(session, target.uid, materials.map((material) => material.uid))).toBeUndefined();

    const host = createLuaScriptHost(session, { readScript: dynamicLinkScript });
    expect(host.loadCardScript(400, { readScript: dynamicLinkScript }).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = findLinkSummonAction(session, target.uid, materials.map((material) => material.uid));
    expect(action).toBeDefined();
    const result = host.loadScript(
      `
      local link=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode,400), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      local first=Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local second=Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      local third=Duel.GetFieldCard(0, LOCATION_MZONE, 2)
      Debug.Message("final link target " .. link:GetLink() .. "/" .. tostring(link:IsLinkSummonable(nil, Group.FromCards(first, second, third), 3, 3)))
      `,
      "final-link-target.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("final link target 3/true");

    if (!action) throw new Error("Expected Link Summon action");
    expect(applyResponse(session, action).ok).toBe(true);
    expect(session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "monsterZone", summonType: "link" });
  });
});

function createStartedSession(cards: DuelCardData[], deck: { main: string[]; extra?: string[] }): DuelSession {
  const session = createDuel({ seed: 140, startingHandSize: deck.main.length, cardReader: createCardReader(cards) });
  loadDecks(session, { 0: deck, 1: { main: [] } });
  startDuel(session);
  return session;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  if (!card) throw new Error(`Expected card ${code}`);
  return card;
}

function moveToMonsterZone(session: DuelSession, code: string): DuelCardInstance {
  const card = moveDuelCard(session.state, requireCard(session, code).uid, "monsterZone", 0);
  card.position = "faceUpAttack";
  return card;
}

function findLinkSummonAction(session: DuelSession, uid: string, materialUids: string[]): LinkSummonAction | undefined {
  const requested = uidSetKey(materialUids);
  return getDuelLegalActions(session, 0).find((action): action is LinkSummonAction => action.type === "linkSummon" && action.uid === uid && uidSetKey(action.materialUids) === requested);
}

function uidSetKey(uids: string[]): string {
  return [...uids].sort().join("|");
}

function dynamicLinkScript(name: string): string | undefined {
  if (name === "c100.lua") {
    return `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CHANGE_LINK)
        e:SetValue(3)
        c:RegisterEffect(e)
      end
    `;
  }
  if (name === "c200.lua") {
    return `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_UPDATE_LINK)
        e:SetValue(1)
        c:RegisterEffect(e)
      end
    `;
  }
  if (name === "c400.lua") {
    return `
      c400={}
      function c400.initial_effect(c)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_SINGLE)
        e1:SetCode(EFFECT_CHANGE_LINK)
        e1:SetValue(2)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_SINGLE)
        e2:SetCode(EFFECT_CHANGE_LINK_FINAL)
        e2:SetValue(3)
        c:RegisterEffect(e2)
      end
    `;
  }
  return undefined;
}
