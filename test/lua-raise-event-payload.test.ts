import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua raised event payloads", () => {
  function createPayloadSession(seed: number) {
    const cards: DuelCardData[] = [
      { code: "100", name: "Raised Target", kind: "monster" },
      { code: "200", name: "Event Player Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);
    return session;
  }

  function activateFirstTrigger(session: ReturnType<typeof createDuel>) {
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const result = applyResponse(session, trigger!);
    expect(result.ok, result.error).toBe(true);
    const pass = getDuelLegalActions(session, session.state.waitingFor ?? 0).find((candidate) => candidate.type === "passChain");
    if (pass) {
      const passResult = applyResponse(session, pass);
      expect(passResult.ok, passResult.error).toBe(true);
    }
  }

  function activateFirstRestoredTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>) {
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const result = applyLuaRestoreResponse(restored, trigger!);
    expect(result.ok, result.error).toBe(true);
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }

  it("makes earlier Lua optional when triggers miss timing at raised event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Raised Boundary Source", kind: "monster" },
      { code: "200", name: "Moved Boundary Target", kind: "monster" },
      { code: "300", name: "When To Grave Watcher", kind: "monster" },
      { code: "400", name: "If To Grave Watcher", kind: "monster" },
      { code: "500", name: "Custom Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 209, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local custom_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.SendtoGrave(target, REASON_EFFECT)
        Duel.RaiseSingleEvent(source, EVENT_CUSTOM+9, e, REASON_EFFECT, tp, tp, 9)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_TO_GRAVE)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when to grave resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_TO_GRAVE)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if to grave resolved")
      end)
      if_watcher:RegisterEffect(if_effect)

      local custom_effect=Effect.CreateEffect(custom_watcher)
      custom_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      custom_effect:SetCode(EVENT_CUSTOM+9)
      custom_effect:SetRange(LOCATION_HAND)
      custom_effect:SetOperation(function(e,tp)
        Debug.Message("custom boundary resolved")
      end)
      custom_watcher:RegisterEffect(custom_effect)
      `,
      "raise-event-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    const customEventCode = 0x10000000 + 9;
    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1014");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1014", `lua-4-${customEventCode}`]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToGraveyard", eventCode: 1014 }), expect.objectContaining({ eventName: "customEvent", eventCode: customEventCode })]),
    );
  });

  it("makes Lua optional when raised triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Raised Later Boundary Source", kind: "monster" },
      { code: "300", name: "When Custom Watcher", kind: "monster" },
      { code: "400", name: "If Custom Watcher", kind: "monster" },
      { code: "500", name: "Damage Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 210, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "400", "500"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.RaiseSingleEvent(source, EVENT_CUSTOM+10, e, REASON_EFFECT, tp, tp, 10)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_CUSTOM+10)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when custom resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_CUSTOM+10)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if custom resolved")
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
      `,
      "raise-event-later-boundary-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    const customEventCode = 0x10000000 + 10;
    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain(`lua-2-${customEventCode}`);
    expect(pendingEffectIds).toEqual(expect.arrayContaining([`lua-3-${customEventCode}`, "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "customEvent", eventCode: customEventCode }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
  });

  it("preserves Duel.RaiseEvent callback payloads through trigger checks and resolution", () => {
    const session = createPayloadSession(203);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(watcher)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_TO_GRAVE)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("condition payload " .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp)
        return ep==1 and ev==77 and r==REASON_EFFECT and rp==1
      end)
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("operation payload " .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp)
      end)
      watcher:RegisterEffect(e)
      Duel.RaiseEvent(target, EVENT_TO_GRAVE, nil, REASON_EFFECT, 1, 1, 77)
      `,
      "raise-event-player.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("condition payload 1/77/64/1");
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToGraveyard", eventCode: 1014, eventPlayer: 1, eventValue: 77, eventReason: 64, eventReasonPlayer: 1 });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "sentToGraveyard", eventCode: 1014, eventPlayer: 1, eventValue: 77, eventReason: 64, eventReasonPlayer: 1 });

    activateFirstTrigger(session);
    expect(host.messages).toContain("operation payload 1/77/64/1");
  });

  it("preserves Duel.RaiseSingleEvent callback payloads through trigger checks and resolution", () => {
    const session = createPayloadSession(204);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(watcher)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_TO_HAND)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("single condition payload " .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp)
        return ep==1 and ev==88 and r==REASON_EFFECT and rp==1
      end)
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("single operation payload " .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp)
      end)
      watcher:RegisterEffect(e)
      Duel.RaiseSingleEvent(target, EVENT_TO_HAND, nil, REASON_EFFECT, 1, 1, 88)
      `,
      "raise-single-event-payload.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("single condition payload 1/88/64/1");
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToHand", eventCode: 1012, eventPlayer: 1, eventValue: 88, eventReason: 64, eventReasonPlayer: 1 });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "sentToHand", eventCode: 1012, eventPlayer: 1, eventValue: 88, eventReason: 64, eventReasonPlayer: 1 });

    const restored = restoreDuel(serializeDuel(session), createCardReader([
      { code: "100", name: "Raised Target", kind: "monster" },
      { code: "200", name: "Event Player Watcher", kind: "monster" },
    ]));
    expect(restored.state.pendingTriggers).toEqual([]);
    expect(restored.state.eventHistory).toEqual(session.state.eventHistory);

    activateFirstTrigger(session);
    expect(host.messages).toContain("single operation payload 1/88/64/1");
  });

  it("preserves the related effect from Duel.RaiseEvent callback args", () => {
    const session = createPayloadSession(206);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local start=Effect.CreateEffect(starter)
      start:SetType(EFFECT_TYPE_IGNITION)
      start:SetRange(LOCATION_HAND)
      start:SetLabel(321)
      start:SetOperation(function(e,tp)
        Duel.RaiseEvent(starter, EVENT_TO_GRAVE, e, REASON_EFFECT, 1, 1, 55)
      end)
      starter:RegisterEffect(start)
      local watch=Effect.CreateEffect(watcher)
      watch:SetType(EFFECT_TYPE_TRIGGER_O)
      watch:SetCode(EVENT_TO_GRAVE)
      watch:SetRange(LOCATION_HAND)
      watch:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("related condition " .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp .. "/" .. re:GetLabel())
        return ep==1 and ev==55 and r==REASON_EFFECT and rp==1 and re:GetLabel()==321
      end)
      watch:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("related operation " .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp .. "/" .. tostring(re~=nil))
        local ceg,cep,cev,cre,cr,crp=Duel.GetChainEvent(0)
        Debug.Message("related chain event " .. ceg:GetFirst():GetCode() .. "/" .. cep .. "/" .. cev .. "/" .. cr .. "/" .. crp .. "/" .. cre:GetLabel())
        local ok,eg2,ep2,ev2,re2,r2,rp2=Duel.CheckEvent(EVENT_TO_GRAVE,true)
        Debug.Message("related check event " .. tostring(ok) .. "/" .. eg2:GetFirst():GetCode() .. "/" .. ep2 .. "/" .. ev2 .. "/" .. r2 .. "/" .. rp2 .. "/" .. re2:GetLabel())
      end)
      watcher:RegisterEffect(watch)
      `,
      "raise-event-related-effect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const startAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(startAction).toBeDefined();
    expect(applyResponse(session, startAction!).ok).toBe(true);
    expect(host.messages).toContain("related condition 1/55/64/1/321");
    const starter = session.state.cards.find((card) => card.code === "100");
    expect(starter).toBeDefined();
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToGraveyard", eventCode: 1014, eventPlayer: 1, eventValue: 55, eventReason: 64, eventReasonPlayer: 1, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1, relatedEffectId: 1 });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "sentToGraveyard", eventReasonCardUid: starter!.uid, eventReasonEffectId: 1, relatedEffectId: 1 })]));
    const restored = restoreDuel(serializeDuel(session), createCardReader([
      { code: "100", name: "Raised Target", kind: "monster" },
      { code: "200", name: "Event Player Watcher", kind: "monster" },
    ]));
    expect(restored.state.pendingTriggers).toEqual([]);
    expect(restored.state.eventHistory).toEqual(session.state.eventHistory);

    activateFirstTrigger(session);
    expect(host.messages).toContain("related operation 1/55/64/1/true");
    expect(host.messages).toContain("related chain event 100/1/55/64/1/321");
    expect(host.messages).toContain("related check event true/100/1/55/64/1/321");
  });

  it("preserves the related effect from Duel.RaiseSingleEvent callback args", () => {
    const session = createPayloadSession(208);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local start=Effect.CreateEffect(starter)
      start:SetType(EFFECT_TYPE_IGNITION)
      start:SetRange(LOCATION_HAND)
      start:SetLabel(987)
      start:SetOperation(function(e,tp)
        Duel.RaiseSingleEvent(starter, EVENT_TO_HAND, e, REASON_EFFECT, 1, 1, 44)
      end)
      starter:RegisterEffect(start)
      local watch=Effect.CreateEffect(watcher)
      watch:SetType(EFFECT_TYPE_TRIGGER_O)
      watch:SetCode(EVENT_TO_HAND)
      watch:SetRange(LOCATION_HAND)
      watch:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("single related condition " .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp .. "/" .. re:GetLabel())
        return ep==1 and ev==44 and r==REASON_EFFECT and rp==1 and re:GetLabel()==987
      end)
      watch:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("single related operation " .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp .. "/" .. re:GetLabel())
      end)
      watcher:RegisterEffect(watch)
      `,
      "raise-single-event-related-effect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const startAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(startAction).toBeDefined();
    expect(applyResponse(session, startAction!).ok).toBe(true);
    expect(host.messages).toContain("single related condition 1/44/64/1/987");
    const starter = session.state.cards.find((card) => card.code === "100");
    expect(starter).toBeDefined();
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToHand", eventCode: 1012, eventPlayer: 1, eventValue: 44, eventReason: 64, eventReasonPlayer: 1, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1, relatedEffectId: 1 });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "sentToHand", eventReasonCardUid: starter!.uid, eventReasonEffectId: 1, relatedEffectId: 1 })]));

    activateFirstTrigger(session);
    expect(host.messages).toContain("single related operation 1/44/64/1/987");
  });

  it("preserves raised-event payloads when a queued Lua trigger is restored and resolved", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restored Raised Target", kind: "monster" },
      { code: "200", name: "Restored Event Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 205, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const source = {
      readScript(name: string) {
        if (name !== "c200.lua") return undefined;
        return `
        c200={}
        function c200.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_TO_GRAVE)
          e:SetRange(LOCATION_HAND)
          e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
            return ep==1 and ev==99 and r==REASON_EFFECT and rp==1
          end)
          e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
            Debug.Message("restored operation payload " .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp)
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.RaiseEvent(target, EVENT_TO_GRAVE, nil, REASON_EFFECT, 1, 1, 99)
      `,
      "queue-restored-payload.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToGraveyard", eventCode: 1014, eventPlayer: 1, eventValue: 99, eventReason: 64, eventReasonPlayer: 1 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.loadedScripts).toEqual([{ ok: true, name: "c200.lua" }]);
    expect(restored.restoreComplete).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(restored.session.state.eventHistory).toEqual(session.state.eventHistory);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));

    activateFirstRestoredTrigger(restored);
    expect(restored.host.messages).toContain("restored operation payload 1/99/64/1");
  });

  it("preserves raised event groups when a queued Lua trigger is restored and resolved", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restored Group Target A", kind: "monster" },
      { code: "101", name: "Restored Group Target B", kind: "monster" },
      { code: "200", name: "Restored Group Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 210, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "101", "200"] }, 1: { main: [] } });
    startDuel(session);

    const source = {
      readScript(name: string) {
        if (name !== "c200.lua") return undefined;
        return `
        c200={}
        function c200.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_TO_GRAVE)
          e:SetRange(LOCATION_HAND)
          e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
            Debug.Message("restored group condition " .. eg:GetCount() .. "/" .. ep .. "/" .. ev)
            return eg:GetCount()==2 and ep==1 and ev==22
          end)
          e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
            Debug.Message("restored group operation " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode() .. "/" .. ep .. "/" .. ev)
            local ceg,cep,cev=Duel.GetChainEvent(0)
            Debug.Message("restored group chain " .. ceg:GetCount() .. "/" .. ceg:GetFirst():GetCode() .. "/" .. cep .. "/" .. cev)
            local ok,eg2,ep2,ev2=Duel.CheckEvent(EVENT_TO_GRAVE,true)
            Debug.Message("restored group check " .. tostring(ok) .. "/" .. eg2:GetCount() .. "/" .. ep2 .. "/" .. ev2)
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      local targets=Duel.SelectMatchingCard(0, function(c) return c:IsCode(100) or c:IsCode(101) end, 0, LOCATION_HAND, 0, 2, 2, nil)
      Duel.RaiseEvent(targets, EVENT_TO_GRAVE, nil, REASON_EFFECT, 1, 1, 22)
      `,
      "queue-restored-group-payload.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("restored group condition 2/1/22");
    const eventUids = session.state.cards.filter((card) => card.code === "100" || card.code === "101").map((card) => card.uid);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToGraveyard", eventCode: 1014, eventPlayer: 1, eventValue: 22, eventUids });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "sentToGraveyard", eventCode: 1014, eventPlayer: 1, eventValue: 22, eventUids });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(restored.session.state.eventHistory).toEqual(session.state.eventHistory);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));

    activateFirstRestoredTrigger(restored);
    expect(restored.host.messages).toContain("restored group operation 2/100/1/22");
    expect(restored.host.messages).toContain("restored group chain 2/100/1/22");
    expect(restored.host.messages).toContain("restored group check true/2/1/22");
  });

  it("preserves the related effect when a queued Lua trigger is restored and resolved", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restored Related Starter", kind: "monster" },
      { code: "200", name: "Restored Related Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 207, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetLabel(654)
            e:SetOperation(function(e,tp)
              Duel.RaiseEvent(c, EVENT_TO_GRAVE, e, REASON_EFFECT, 1, 1, 66)
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c200.lua") {
          return `
          c200={}
          function c200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_TO_GRAVE)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
              return ep==1 and ev==66 and r==REASON_EFFECT and rp==1 and re:GetLabel()==654
            end)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored related operation " .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp .. "/" .. re:GetLabel())
              local ceg,cep,cev,cre,cr,crp=Duel.GetChainEvent(0)
              Debug.Message("restored related chain event " .. ceg:GetFirst():GetCode() .. "/" .. cep .. "/" .. cev .. "/" .. cr .. "/" .. crp .. "/" .. cre:GetLabel())
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const startAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(startAction).toBeDefined();
    expect(applyResponse(session, startAction!).ok).toBe(true);
    const starter = session.state.cards.find((card) => card.code === "100");
    expect(starter).toBeDefined();
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToGraveyard", eventCode: 1014, eventPlayer: 1, eventValue: 66, eventReason: 64, eventReasonPlayer: 1, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1, relatedEffectId: 1 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.loadedScripts).toEqual([{ ok: true, name: "c100.lua" }, { ok: true, name: "c200.lua" }]);
    expect(restored.restoreComplete).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(restored.session.state.eventHistory).toEqual(session.state.eventHistory);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));

    activateFirstRestoredTrigger(restored);
    expect(restored.host.messages).toContain("restored related operation 1/66/64/1/654");
    expect(restored.host.messages).toContain("restored related chain event 100/1/66/64/1/654");
  });

  it("preserves the related effect from RaiseSingleEvent when a queued Lua trigger is restored and resolved", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restored Single Related Starter", kind: "monster" },
      { code: "200", name: "Restored Single Related Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 209, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetLabel(765)
            e:SetOperation(function(e,tp)
              Duel.RaiseSingleEvent(c, EVENT_TO_HAND, e, REASON_EFFECT, 1, 1, 33)
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c200.lua") {
          return `
          c200={}
          function c200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_TO_HAND)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
              return ep==1 and ev==33 and r==REASON_EFFECT and rp==1 and re:GetLabel()==765
            end)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored single related operation " .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp .. "/" .. re:GetLabel())
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const startAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(startAction).toBeDefined();
    expect(applyResponse(session, startAction!).ok).toBe(true);
    const starter = session.state.cards.find((card) => card.code === "100");
    expect(starter).toBeDefined();
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToHand", eventCode: 1012, eventPlayer: 1, eventValue: 33, eventReason: 64, eventReasonPlayer: 1, eventReasonCardUid: starter!.uid, eventReasonEffectId: 1, relatedEffectId: 1 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.loadedScripts).toEqual([{ ok: true, name: "c100.lua" }, { ok: true, name: "c200.lua" }]);
    expect(restored.restoreComplete).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(restored.session.state.eventHistory).toEqual(session.state.eventHistory);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));

    activateFirstRestoredTrigger(restored);
    expect(restored.host.messages).toContain("restored single related operation 1/33/64/1/765");
  });
});
