import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  applyResponse,
  createDuel,
  detachDuelOverlayMaterials,
  destroyDuelCard,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  restoreDuel,
  serializeDuel,
  specialSummonDuelCard,
  startDuel,
  xyzSummonDuelCard,
} from "#duel/core.js";
import { getCards, moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua overlay and pendulum movement helpers", () => {
  it("lets Lua scripts inspect Xyz overlay materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Overlay Material A", kind: "monster" },
      { code: "300", name: "Overlay Material B", kind: "monster" },
      { code: "920", name: "Overlay Xyz", kind: "extra", xyzMaterials: ["100", "300"] },
    ];
    const session = createDuel({ seed: 21, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["920"] },
      1: { main: ["100", "300"] },
    });
    startDuel(session);

    const xyz = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    const materials = session.state.cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);
    xyzSummonDuelCard(session.state, 0, xyz!.uid, materials.map((card) => card.uid));

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local xyz = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 920), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local overlays = xyz:GetOverlayGroup()
      local first = overlays:GetFirst()
      local second = overlays:GetNext()
      Debug.Message("overlay count " .. xyz:GetOverlayCount() .. "/" .. overlays:GetCount())
      Debug.Message("duel overlay count " .. Duel.GetOverlayCount(0, 1, 0) .. "/" .. Duel.GetOverlayGroup(0, 1, 0):GetCount() .. "/" .. Duel.GetOverlayCount(0, 0, 1))
      Debug.Message("overlay codes " .. first:GetCode() .. "/" .. second:GetCode())
      Debug.Message("card can detach one " .. tostring(xyz:CheckRemoveOverlayCard(0, 1, REASON_COST)))
      Debug.Message("card can detach three " .. tostring(xyz:CheckRemoveOverlayCard(0, 3, REASON_COST)))
      Debug.Message("duel can detach one " .. tostring(Duel.CheckRemoveOverlayCard(0, 1, 0, 1, REASON_COST)))
      Debug.Message("duel can detach three " .. tostring(Duel.CheckRemoveOverlayCard(0, 1, 0, 3, REASON_COST)))
      Debug.Message("card detach " .. xyz:RemoveOverlayCard(0, 1, 1, REASON_COST))
      Debug.Message("card detach operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("overlay after card detach " .. xyz:GetOverlayCount())
      Debug.Message("duel detach " .. Duel.RemoveOverlayCard(0, LOCATION_MZONE, 0, 1, 1, REASON_COST))
      Debug.Message("duel detach operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("overlay after duel detach " .. xyz:GetOverlayCount())
      Debug.Message("duel detach empty " .. Duel.RemoveOverlayCard(0, LOCATION_MZONE, 0, 1, 1, REASON_COST))
      Debug.Message("empty detach operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "overlay-helpers.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("overlay count 2/2");
    expect(host.messages).toContain("duel overlay count 2/2/0");
    expect(host.messages).toContain("overlay codes 100/300");
    expect(host.messages).toContain("card can detach one true");
    expect(host.messages).toContain("card can detach three false");
    expect(host.messages).toContain("duel can detach one true");
    expect(host.messages).toContain("duel can detach three false");
    expect(host.messages).toContain("card detach 1");
    expect(host.messages).toContain("card detach operated 1/100");
    expect(host.messages).toContain("overlay after card detach 1");
    expect(host.messages).toContain("duel detach 1");
    expect(host.messages).toContain("duel detach operated 1/300");
    expect(host.messages).toContain("overlay after duel detach 0");
    expect(host.messages).toContain("duel detach empty 0");
    expect(host.messages).toContain("empty detach operated 0");
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids).toEqual([]);
    expect(materials.every((card) => session.state.cards.find((candidate) => candidate.uid === card.uid)?.location === "graveyard")).toBe(true);
  });

  it("maps LOCATION_OVERLAY for Lua current, previous, and destination location checks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Overlay Location Material", kind: "monster" },
      { code: "920", name: "Overlay Location Xyz", kind: "extra" },
    ];
    const session = createDuel({ seed: 196, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"], extra: ["920"] },
      1: { main: [] },
    });
    startDuel(session);

    const material = session.state.cards.find((card) => card.code === "100");
    const xyz = session.state.cards.find((card) => card.code === "920");
    expect(material).toBeDefined();
    expect(xyz).toBeDefined();
    moveDuelCard(session.state, xyz!.uid, "monsterZone", 0);
    moveDuelCard(session.state, material!.uid, "overlay", 0);
    xyz!.overlayUids.push(material!.uid);

    const host = createLuaScriptHost(session);
    const current = host.loadScript(
      `
      local xyz=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 920), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local mat=xyz:GetOverlayGroup():GetFirst()
      Debug.Message("overlay current " .. LOCATION_OVERLAY .. "/" .. mat:GetLocation() .. "/" .. tostring(mat:IsLocation(LOCATION_OVERLAY)) .. "/" .. tostring(mat:IsLocation(LOCATION_ONFIELD|LOCATION_OVERLAY)))
      `,
      "overlay-location-current.lua",
    );
    expect(current.ok, current.error).toBe(true);
    expect(host.messages).toContain("overlay current 128/128/true/true");

    detachDuelOverlayMaterials(session.state, xyz!.uid, 1, 0);
    const moved = host.loadScript(
      `
      local mat=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      Debug.Message("overlay moved " .. mat:GetPreviousLocation() .. "/" .. tostring(mat:IsPreviousLocation(LOCATION_OVERLAY)) .. "/" .. tostring(mat:IsPreviousLocation(LOCATION_OVERLAY|LOCATION_SZONE)) .. "/" .. mat:GetDestination() .. "/" .. tostring(mat:IsDestination(LOCATION_GRAVE)))
      `,
      "overlay-location-moved.lua",
    );

    expect(moved.ok, moved.error).toBe(true);
    expect(host.messages).toContain("overlay moved 128/true/true/0/true");
  });

  it("queues Lua detach-material triggers after overlay materials are detached", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Detach Event Material", kind: "monster" },
      { code: "300", name: "Detach Event Watcher", kind: "monster" },
      { code: "920", name: "Detach Event Xyz", kind: "extra", xyzMaterials: ["100", "300"] },
    ];
    const session = createDuel({ seed: 174, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["920"] },
      1: { main: [] },
    });
    startDuel(session);

    const material = session.state.cards.find((card) => card.code === "100");
    const xyz = session.state.cards.find((card) => card.code === "920");
    expect(material).toBeDefined();
    expect(xyz).toBeDefined();
    moveDuelCard(session.state, xyz!.uid, "monsterZone", 0);
    moveDuelCard(session.state, material!.uid, "overlay", 0);
    xyz!.overlayUids.push(material!.uid);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local xyz=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 920), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(watcher)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_DETACH_MATERIAL)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp,eg)
        Debug.Message("detach trigger resolved " .. eg:GetFirst():GetCode())
      end)
      watcher:RegisterEffect(e)

      Debug.Message("detach event count " .. xyz:RemoveOverlayCard(0, 1, 1, REASON_COST))
      `,
      "overlay-detach-event.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("detach event count 1");
    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["detachedMaterial"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1202, eventCardUid: material!.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("detach trigger resolved 100");
  });

  it("makes earlier Lua optional when triggers miss timing at overlay detach boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Overlay Boundary Source", kind: "monster" },
      { code: "200", name: "Overlay Boundary Target", kind: "monster" },
      { code: "300", name: "When To Hand Watcher", kind: "monster" },
      { code: "400", name: "If To Hand Watcher", kind: "monster" },
      { code: "500", name: "Overlay Boundary Material", kind: "monster" },
      { code: "600", name: "Detach Boundary Watcher", kind: "monster" },
      { code: "920", name: "Overlay Boundary Xyz", kind: "extra" },
    ];
    const session = createDuel({ seed: 202, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600"], extra: ["920"] },
      1: { main: [] },
    });
    startDuel(session);

    const xyz = session.state.cards.find((card) => card.code === "920");
    const material = session.state.cards.find((card) => card.code === "500");
    expect(xyz).toBeDefined();
    expect(material).toBeDefined();
    const target = session.state.cards.find((card) => card.code === "200");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "graveyard", 0);
    moveDuelCard(session.state, xyz!.uid, "monsterZone", 0);
    moveDuelCard(session.state, material!.uid, "overlay", 0);
    xyz!.overlayUids.push(material!.uid);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local detach_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local xyz=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 920), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.SendtoHand(target, tp, REASON_EFFECT)
        xyz:RemoveOverlayCard(tp, 1, 1, REASON_EFFECT)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_TO_HAND)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when to hand resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_TO_HAND)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if to hand resolved")
      end)
      if_watcher:RegisterEffect(if_effect)

      local detach_effect=Effect.CreateEffect(detach_watcher)
      detach_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      detach_effect:SetCode(EVENT_DETACH_MATERIAL)
      detach_effect:SetRange(LOCATION_HAND)
      detach_effect:SetOperation(function(e,tp)
        Debug.Message("detach boundary resolved")
      end)
      detach_watcher:RegisterEffect(detach_effect)
      `,
      "overlay-detach-missed-timing.lua",
    );
    expect(result.ok, result.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1012");
    expect(pendingEffectIds).toContain("lua-4-1202");
    const source = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    expect(session.state.pendingTriggers).toContainEqual(
      expect.objectContaining({ eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }),
    );
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToHand", eventCode: 1012 }), expect.objectContaining({ eventName: "detachedMaterial", eventCode: 1202, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 })]),
    );
  });

  it("makes Lua optional when detach-material triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Detach Later Boundary Source", kind: "monster" },
      { code: "300", name: "When Detach Watcher", kind: "monster" },
      { code: "400", name: "If Detach Watcher", kind: "monster" },
      { code: "500", name: "Detach Later Boundary Material", kind: "monster" },
      { code: "600", name: "Damage Boundary Watcher", kind: "monster" },
      { code: "920", name: "Detach Later Boundary Xyz", kind: "extra" },
    ];
    const session = createDuel({ seed: 203, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "400", "500", "600"], extra: ["920"] }, 1: { main: [] } });
    startDuel(session);

    const xyz = session.state.cards.find((card) => card.code === "920");
    const material = session.state.cards.find((card) => card.code === "500");
    expect(xyz).toBeDefined();
    expect(material).toBeDefined();
    moveDuelCard(session.state, xyz!.uid, "monsterZone", 0);
    moveDuelCard(session.state, material!.uid, "overlay", 0);
    xyz!.overlayUids.push(material!.uid);

    const host = createLuaScriptHost(session);
    const scriptName = "overlay-detach-later-boundary-missed-timing.lua";
    const script = `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local xyz=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 920), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        xyz:RemoveOverlayCard(tp, 1, 1, REASON_EFFECT)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_DETACH_MATERIAL)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when detach resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_DETACH_MATERIAL)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if detach resolved")
      end)
      if_watcher:RegisterEffect(if_effect)

      local damage_effect=Effect.CreateEffect(damage_watcher)
      damage_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      damage_effect:SetCode(EVENT_DAMAGE)
      damage_effect:SetRange(LOCATION_HAND)
      damage_effect:SetOperation(function(e,tp)
        Debug.Message("damage boundary resolved")
      end)
      damage_watcher:RegisterEffect(damage_effect)
      `;
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp)
              local xyz=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 920), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
              xyz:RemoveOverlayCard(tp, 1, 1, REASON_EFFECT)
              Duel.Damage(1, 100, REASON_EFFECT)
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c300.lua") {
          return `
          c300={}
          function c300.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_DETACH_MATERIAL)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("when detach resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c400.lua") {
          return `
          c400={}
          function c400.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_DETACH_MATERIAL)
            e:SetProperty(EFFECT_FLAG_DELAY)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("if detach resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c600.lua") {
          return `
          c600={}
          function c600.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_DAMAGE)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("damage boundary resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const result = host.loadScript(script, scriptName);
    expect(result.ok, result.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1202");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1202", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "detachedMaterial", eventCode: 1202 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPendingEffectIds = restored.session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(restoredPendingEffectIds).not.toContain("lua-2-1202");
    expect(restoredPendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1202", "lua-4-1111"]));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
  });

  it("lets Lua scripts attach Xyz overlay materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attach Material A", kind: "monster" },
      { code: "300", name: "Attach Material B", kind: "monster" },
      { code: "920", name: "Attach Xyz", kind: "extra" },
    ];
    const session = createDuel({ seed: 31, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["920"] },
      1: { main: ["100", "300"] },
    });
    startDuel(session);

    const xyz = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    const fieldMaterial = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(xyz).toBeTruthy();
    expect(fieldMaterial).toBeTruthy();
    moveDuelCard(session.state, xyz!.uid, "monsterZone", 0);
    moveDuelCard(session.state, fieldMaterial!.uid, "monsterZone", 0);
    xyz!.faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local xyz = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 920), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local materials = Duel.SelectMatchingCard(0, function(c) return c:IsCode(100) or c:IsCode(300) end, 0, LOCATION_HAND + LOCATION_MZONE, 0, 1, 2, nil)
      Duel.Overlay(xyz, materials)
      local overlays = xyz:GetOverlayGroup()
      Debug.Message("attach overlay count " .. xyz:GetOverlayCount() .. "/" .. overlays:GetCount())
      Debug.Message("attach operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("attach has 100 " .. tostring(overlays:IsExists(aux.FilterBoolFunction(Card.IsCode, 100), 1, nil)))
      Debug.Message("attach has 300 " .. tostring(overlays:IsExists(aux.FilterBoolFunction(Card.IsCode, 300), 1, nil)))
      `,
      "overlay-attach.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("attach overlay count 2/2");
    expect(host.messages).toContain("attach operated 2");
    expect(host.messages).toContain("attach has 100 true");
    expect(host.messages).toContain("attach has 300 true");
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids).toHaveLength(2);
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "100")?.location).toBe("overlay");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "300")?.location).toBe("overlay");
  });

  it("preserves active Lua reason source metadata on attached overlay materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Overlay Source", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Overlay Reason Material", kind: "monster", typeFlags: 0x21 },
      { code: "920", name: "Overlay Reason Xyz", kind: "extra" },
    ];
    const session = createDuel({ seed: 312, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"], extra: ["920"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const material = session.state.cards.find((card) => card.code === "200");
    const xyz = session.state.cards.find((card) => card.code === "920");
    expect(source).toBeDefined();
    expect(material).toBeDefined();
    expect(xyz).toBeDefined();
    moveDuelCard(session.state, xyz!.uid, "monsterZone", 0);
    xyz!.faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source_effect=nil
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local xyz=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 920), tp, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
          local material=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
          Duel.Overlay(xyz, material)
          local attached=xyz:GetOverlayGroup():GetFirst()
          Debug.Message("overlay reason source " .. tostring(attached:GetReasonCard()==c) .. "/" .. tostring(attached:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      `,
      "overlay-attach-reason-source.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("overlay reason source true/true");
    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "overlay", reasonCardUid: source!.uid, reasonEffectId: 1 });
  });

  it("keeps overlay helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Ended Overlay Material", kind: "monster" },
      { code: "920", name: "Ended Overlay Xyz", kind: "extra" },
    ];
    const session = createDuel({ seed: 311, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"], extra: ["920"] },
      1: { main: [] },
    });
    startDuel(session);
    const xyz = session.state.cards.find((card) => card.code === "920");
    const material = session.state.cards.find((card) => card.code === "100");
    expect(xyz).toBeDefined();
    expect(material).toBeDefined();
    moveDuelCard(session.state, xyz!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local xyz = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 920), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local material = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      Duel.Win(0, WIN_REASON_EXODIA)
      Duel.Overlay(xyz, material)
      Debug.Message("attach operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("detach " .. Duel.RemoveOverlayCard(0, LOCATION_MZONE, 0, 1, 1, REASON_COST))
      Debug.Message("detach operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "ended-overlay-noop.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["attach operated 0", "detach 0", "detach operated 0"]);
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids).toEqual([]);
    expect(session.state.cards.find((card) => card.uid === material!.uid)?.location).toBe("hand");
    expect(session.state.pendingTriggers).toEqual([]);
  });

  it("lets Lua effects pay Xyz overlay detach costs before resolving", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Detach Material A", kind: "monster" },
      { code: "300", name: "Detach Material B", kind: "monster" },
      { code: "920", name: "Detach Cost Xyz", kind: "extra", xyzMaterials: ["100", "300"] },
    ];
    const session = createDuel({ seed: 30, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["920"] },
      1: { main: ["100", "300"] },
    });
    startDuel(session);

    const xyz = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    const materials = session.state.cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);
    xyzSummonDuelCard(session.state, 0, xyz!.uid, materials.map((card) => card.uid));
    detachDuelOverlayMaterials(session.state, xyz!.uid, 1, 0);

    const remainingOverlayUid = session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids[0];
    const remainingOverlayCode = session.state.cards.find((card) => card.uid === remainingOverlayUid)?.code;
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c920={}
      function c920.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
          local c=e:GetHandler()
          if chk==0 then
            Debug.Message("detach cost check " .. c:GetOverlayCount())
            return c:GetOverlayCount()>0
          end
          Debug.Message("detach cost pay " .. c:GetOverlayCount())
          return c:RemoveOverlayCard(tp,1,1,REASON_COST)==1
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("detach cost operation " .. e:GetHandler():GetOverlayCount())
        end)
        c:RegisterEffect(e)
      end
      `,
      "xyz-detach-cost.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(host.messages).toContain("detach cost check 1");
    const activation = applyAndAssert(session, action!);

    expect(activation.ok).toBe(true);
    expect(host.messages).toContain("detach cost pay 1");
    expect(host.messages).toContain("detach cost operation 0");
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids).toEqual([]);
    expect(session.state.cards.find((card) => card.uid === remainingOverlayUid)).toMatchObject({ code: remainingOverlayCode, location: "graveyard" });
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect" && candidate.uid === xyz!.uid)).toBe(false);
  });

  it("lets Lua scripts special summon face-up pendulum monsters from the extra deck", () => {
    const cards: DuelCardData[] = [
      { code: "101", name: "Lua Low Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
      { code: "102", name: "Lua High Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
      { code: "301", name: "Lua Pendulum Return", kind: "monster", typeFlags: 0x1000001, level: 4 },
      { code: "920", name: "Lua Face-Down Extra", kind: "extra", typeFlags: 0x800001, level: 4 },
    ];
    const session = createDuel({ seed: 31, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101", "102", "301"], extra: ["920"] },
      1: { main: [] },
    });
    startDuel(session);

    const lowScale = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "101");
    const highScale = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "102");
    const pendulum = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "301");
    const extra = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    expect(lowScale).toBeTruthy();
    expect(highScale).toBeTruthy();
    expect(pendulum).toBeTruthy();
    expect(extra).toBeTruthy();
    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0).sequence = 1;
    moveDuelCard(session.state, pendulum!.uid, "extraDeck", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local pendulum = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      local extra = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 920), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      Debug.Message("can pendulum summon " .. tostring(Duel.IsPlayerCanPendulumSummon(0)))
      Debug.Message("pendulum can special " .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, pendulum)))
      Debug.Message("extra can special " .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, extra)))
      Debug.Message("pendulum special " .. Duel.SpecialSummon(pendulum, 0, 0, 0, false, false, POS_FACEUP_ATTACK))
      Debug.Message("can pendulum after summon " .. tostring(Duel.IsPlayerCanPendulumSummon(0)))
      Debug.Message("pendulum operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("extra special " .. Duel.SpecialSummon(extra, 0, 0, 0, false, false, POS_FACEUP_ATTACK))
      Debug.Message("extra operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "pendulum-extra-special.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("can pendulum summon true");
    expect(host.messages).toContain("pendulum can special true");
    expect(host.messages).toContain("extra can special true");
    expect(host.messages).toContain("pendulum special 1");
    expect(host.messages).toContain("can pendulum after summon false");
    expect(host.messages).toContain("pendulum operated 301");
    expect(host.messages).toContain("extra special 1");
    expect(host.messages).toContain("extra operated 1");
    expect(session.state.cards.find((card) => card.uid === pendulum!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "special" });
    expect(session.state.cards.find((card) => card.uid === extra!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "special" });
  });

  it("lets Lua scripts pendulum summon legal hand and face-up extra deck monsters", () => {
    const cards: DuelCardData[] = [
      { code: "101", name: "Lua Low Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
      { code: "102", name: "Lua High Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
      { code: "301", name: "Lua Pendulum Hand", kind: "monster", typeFlags: 0x1000001, level: 4 },
      { code: "302", name: "Lua Pendulum Extra", kind: "monster", typeFlags: 0x1000001, level: 5 },
      { code: "303", name: "Lua Pendulum Out Of Scale", kind: "monster", typeFlags: 0x1000001, level: 9 },
    ];
    const session = createDuel({ seed: 35, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101", "102", "301", "302", "303"] },
      1: { main: [] },
    });
    startDuel(session);

    const lowScale = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "101");
    const highScale = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "102");
    const handPendulum = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "301");
    const extraPendulum = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "302");
    const outOfScale = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "303");
    expect(lowScale).toBeTruthy();
    expect(highScale).toBeTruthy();
    expect(handPendulum).toBeTruthy();
    expect(extraPendulum).toBeTruthy();
    expect(outOfScale).toBeTruthy();
    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0).sequence = 1;
    moveDuelCard(session.state, extraPendulum!.uid, "extraDeck", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("pendulum before " .. tostring(Duel.IsPlayerCanPendulumSummon(0)))
      Debug.Message("pendulum summon " .. Duel.PendulumSummon(0))
      Debug.Message("pendulum operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("pendulum field " .. Duel.GetFieldGroupCount(0, LOCATION_MZONE, 0))
      Debug.Message("pendulum after " .. tostring(Duel.IsPlayerCanPendulumSummon(0)))
      Debug.Message("pendulum summoned flags " .. tostring(Duel.GetOperatedGroup():IsExists(Card.IsPendulumSummoned, 1, nil)) .. "/" .. tostring(Duel.GetOperatedGroup():IsExists(Card.IsSpecialSummoned, 1, nil)))
      local first=Duel.GetOperatedGroup():GetFirst()
      Debug.Message("pendulum summon type " .. first:GetSummonType() .. "/" .. tostring(first:IsSummonType(SUMMON_TYPE_PENDULUM)) .. "/" .. tostring(first:IsSummonType(SUMMON_TYPE_SPECIAL)))
      local hand_card=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local extra_card=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 302), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("pendulum summon locations " .. hand_card:GetSummonLocation() .. "/" .. tostring(hand_card:IsSummonLocation(LOCATION_HAND)) .. "/" .. tostring(hand_card:IsSummonLocation(LOCATION_EXTRA)))
      Debug.Message("pendulum extra summon location " .. extra_card:GetSummonLocation() .. "/" .. tostring(extra_card:IsSummonLocation(LOCATION_EXTRA)) .. "/" .. tostring(extra_card:IsSummonLocation(LOCATION_HAND)))
      `,
      "pendulum-summon.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("pendulum before true");
    expect(host.messages).toContain("pendulum summon 2");
    expect(host.messages).toContain("pendulum operated 2");
    expect(host.messages).toContain("pendulum field 2");
    expect(host.messages).toContain("pendulum after false");
    expect(host.messages).toContain("pendulum summoned flags true/true");
    expect(host.messages).toContain("pendulum summon type 1241513984/true/true");
    expect(host.messages).toContain("pendulum summon locations 2/true/false");
    expect(host.messages).toContain("pendulum extra summon location 64/true/false");
    expect(session.state.cards.find((card) => card.uid === handPendulum!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "pendulum" });
    expect(session.state.cards.find((card) => card.uid === extraPendulum!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "pendulum" });
    expect(session.state.cards.find((card) => card.uid === outOfScale!.uid)).toMatchObject({ location: "hand" });
  });

  it("reports symbolic Pendulum zone summon locations", () => {
    const cards: DuelCardData[] = [
      { code: "301", name: "Lua Pendulum Scale Source", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
    ];
    const session = createDuel({ seed: 253, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["301"] },
      1: { main: [] },
    });
    startDuel(session);

    const pendulum = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "301");
    expect(pendulum).toBeTruthy();
    const moved = moveDuelCard(session.state, pendulum!.uid, "spellTrapZone", 0);
    moved.sequence = 0;
    moved.faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local pendulum=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_PZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("pzone summon " .. Duel.SpecialSummon(pendulum, 0, 0, 0, false, false, POS_FACEUP_ATTACK))
      Debug.Message("pzone summon location " .. pendulum:GetSummonLocation() .. "/" .. tostring(pendulum:IsSummonLocation(LOCATION_SZONE)) .. "/" .. tostring(pendulum:IsSummonLocation(LOCATION_PZONE)) .. "/" .. tostring(pendulum:IsSummonLocation(LOCATION_STZONE)) .. "/" .. tostring(pendulum:IsSummonLocation(LOCATION_FZONE)))
      `,
      "pendulum-zone-summon-location.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("pzone summon 1");
    expect(host.messages).toContain("pzone summon location 8/true/true/false/false");
    expect(session.state.cards.find((card) => card.uid === pendulum!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "special" });
  });

  it("restores Lua pendulum summon eligibility for hand and face-up extra deck monsters", () => {
    const cards: DuelCardData[] = [
      { code: "101", name: "Restore Low Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
      { code: "102", name: "Restore High Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
      { code: "301", name: "Restore Pendulum Hand", kind: "monster", typeFlags: 0x1000001, level: 4 },
      { code: "302", name: "Restore Pendulum Extra", kind: "monster", typeFlags: 0x1000001, level: 5 },
      { code: "303", name: "Restore Pendulum Out Of Scale", kind: "monster", typeFlags: 0x1000001, level: 9 },
    ];
    const session = createDuel({ seed: 36, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101", "102", "301", "302", "303"] },
      1: { main: [] },
    });
    startDuel(session);

    const lowScale = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "101");
    const highScale = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "102");
    const handPendulum = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "301");
    const extraPendulum = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "302");
    const outOfScale = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "303");
    expect(lowScale).toBeTruthy();
    expect(highScale).toBeTruthy();
    expect(handPendulum).toBeTruthy();
    expect(extraPendulum).toBeTruthy();
    expect(outOfScale).toBeTruthy();
    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0).sequence = 1;
    moveDuelCard(session.state, extraPendulum!.uid, "extraDeck", 0);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const host = createLuaScriptHost(restored);
    const result = host.loadScript(
      `
      Debug.Message("restored pendulum before " .. tostring(Duel.IsPlayerCanPendulumSummon(0)))
      Debug.Message("restored pendulum summon " .. Duel.PendulumSummon(0))
      Debug.Message("restored pendulum operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("restored pendulum after " .. tostring(Duel.IsPlayerCanPendulumSummon(0)))
      Debug.Message("restored pendulum summoned flags " .. tostring(Duel.GetOperatedGroup():IsExists(Card.IsPendulumSummoned, 1, nil)) .. "/" .. tostring(Duel.GetOperatedGroup():IsExists(Card.IsSpecialSummoned, 1, nil)))
      `,
      "restored-pendulum-summon.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("restored pendulum before true");
    expect(host.messages).toContain("restored pendulum summon 2");
    expect(host.messages).toContain("restored pendulum operated 2");
    expect(host.messages).toContain("restored pendulum after false");
    expect(host.messages).toContain("restored pendulum summoned flags true/true");
    expect(restored.state.cards.find((card) => card.uid === handPendulum!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "pendulum" });
    expect(restored.state.cards.find((card) => card.uid === extraPendulum!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "pendulum" });
    expect(restored.state.cards.find((card) => card.uid === outOfScale!.uid)).toMatchObject({ location: "hand" });
  });

  it("restores Lua special summon eligibility for face-up extra deck pendulum monsters", () => {
    const cards: DuelCardData[] = [
      { code: "301", name: "Restored Lua Pendulum Return", kind: "monster", typeFlags: 0x1000001, level: 4 },
      { code: "920", name: "Restored Lua Face-Down Extra", kind: "extra", typeFlags: 0x800001, level: 4 },
    ];
    const session = createDuel({ seed: 37, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["301"], extra: ["920"] },
      1: { main: [] },
    });
    startDuel(session);

    const pendulum = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "301");
    const extra = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    expect(pendulum).toBeTruthy();
    expect(extra).toBeTruthy();
    moveDuelCard(session.state, pendulum!.uid, "extraDeck", 0);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const host = createLuaScriptHost(restored);
    const result = host.loadScript(
      `
      local pendulum = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      local extra = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 920), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      Debug.Message("restored pendulum can special " .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, pendulum)))
      Debug.Message("restored extra can special " .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, extra)))
      Debug.Message("restored pendulum special " .. Duel.SpecialSummon(pendulum, 0, 0, 0, false, false, POS_FACEUP_ATTACK))
      Debug.Message("restored extra special " .. Duel.SpecialSummon(extra, 0, 0, 0, false, false, POS_FACEUP_ATTACK))
      Debug.Message("restored operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "restored-pendulum-extra-special.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("restored pendulum can special true");
    expect(host.messages).toContain("restored extra can special true");
    expect(host.messages).toContain("restored pendulum special 1");
    expect(host.messages).toContain("restored extra special 1");
    expect(host.messages).toContain("restored operated 1");
    expect(restored.state.cards.find((card) => card.uid === pendulum!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "special" });
    expect(restored.state.cards.find((card) => card.uid === extra!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "special" });
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
