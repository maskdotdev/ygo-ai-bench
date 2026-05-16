import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  moveDuelCard,
  queryPublicState,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua effect trigger metadata helpers", () => {
  it("maps Lua trigger delay metadata to trigger timing", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Trigger Metadata Source", kind: "monster" }];
    const session = createDuel({ seed: 17, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_effect=Effect.CreateEffect(c)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_TO_GRAVE)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp) Debug.Message("when optional resolved") end)
      c:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(c)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_TO_GRAVE)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp) Debug.Message("if optional resolved") end)
      c:RegisterEffect(if_effect)
      `,
      "trigger-timing-metadata.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const triggers = session.state.effects.filter((effect) => effect.event === "trigger");
    expect(triggers.map((effect) => effect.triggerTiming)).toEqual(["when", "if"]);
    expect(triggers.map((effect) => effect.optional)).toEqual([true, true]);
  });

  it("applies Lua trigger timing to multi-step movement operations", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Starter", kind: "monster" },
      { code: "500", name: "Lua Moved Body", kind: "monster" },
    ];
    const session = createDuel({ seed: 18, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500", "500", "500"] },
      1: { main: ["500", "500", "500", "500"] },
    });
    startDuel(session);

    const scriptSource = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          local s,id=GetID()
          function s.initial_effect(c)
            local starter_effect=Effect.CreateEffect(c)
            starter_effect:SetType(EFFECT_TYPE_IGNITION)
            starter_effect:SetRange(LOCATION_HAND)
            starter_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              local body=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
              local opponent_body=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, 0, LOCATION_HAND, 1, 1, nil):GetFirst()
              Duel.SendtoGrave(body, REASON_EFFECT)
              Duel.SendtoGrave(opponent_body, REASON_EFFECT)
              Debug.Message("lua multistep movement resolved")
            end)
            c:RegisterEffect(starter_effect)
          end
          `;
        }
        if (name === "c500.lua") {
          return `
          local s,id=GetID()
          function s.initial_effect(c)
            local when_effect=Effect.CreateEffect(c)
            when_effect:SetType(EFFECT_TYPE_SINGLE + EFFECT_TYPE_TRIGGER_O)
            when_effect:SetCode(EVENT_TO_GRAVE)
            when_effect:SetRange(LOCATION_GRAVE)
            when_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              if e:GetHandler():GetControler()==0 then
                Debug.Message("lua when optional resolved")
              else
                Debug.Message("lua opponent when optional resolved")
              end
            end)
            c:RegisterEffect(when_effect)

            local if_effect=Effect.CreateEffect(c)
            if_effect:SetType(EFFECT_TYPE_SINGLE + EFFECT_TYPE_TRIGGER_O)
            if_effect:SetCode(EVENT_TO_GRAVE)
            if_effect:SetProperty(EFFECT_FLAG_DELAY)
            if_effect:SetRange(LOCATION_GRAVE)
            if_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              if e:GetHandler():GetControler()==0 then
                Debug.Message("lua if optional resolved")
              else
                Debug.Message("lua opponent if optional resolved")
              end
            end)
            c:RegisterEffect(if_effect)
          end
          `;
        }
      },
    };
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, scriptSource).ok).toBe(true);
    expect(host.loadCardScript(500, scriptSource).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(8);
    const starterAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    expect(starterAction).toBeTruthy();
    const activation = applyResponse(session, starterAction!);

    expect(activation.ok).toBe(true);
    expect(host.messages).toContain("lua multistep movement resolved");
    const pendingTriggerEffects = session.state.pendingTriggers.map((trigger) => session.state.effects.find((effect) => effect.id === trigger.effectId && effect.sourceUid === trigger.sourceUid));
    expect(pendingTriggerEffects.map((effect) => effect?.triggerTiming)).toEqual(["if", "when", "if"]);
    expect(pendingTriggerEffects.map((effect) => effect?.optional)).toEqual([true, true, true]);
    const ifTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(ifTrigger?.uid).toBe(session.state.cards.find((card) => card.controller === 0 && card.location === "graveyard" && card.code === "500")?.uid);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger")).toHaveLength(1);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), scriptSource, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredIfTrigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger");
    expect(restoredIfTrigger).toBeDefined();
    expect(restoredIfTrigger).toMatchObject({ windowId: queryPublicState(restored.session).actionWindowId, windowKind: "triggerBucket" });
    expect(getLuaRestoreLegalActions(restored, 0).filter((action) => action.type === "activateTrigger")).toHaveLength(1);
    expect(getLuaRestoreLegalActions(restored, 1)).toHaveLength(0);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));

    expectLuaRestoreStalePreapply(restored, restoredIfTrigger!, 0);
    applyLuaRestoreAndAssert(restored, restoredIfTrigger!);
    expect(restored.host.messages).toContain("lua if optional resolved");
    const staleRestoredIfTrigger = applyLuaRestoreResponse(restored, restoredIfTrigger!);
    expect(staleRestoredIfTrigger.ok).toBe(false);
    expect(staleRestoredIfTrigger.error).toContain("Response is not currently legal");
    expect(staleRestoredIfTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleRestoredIfTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(staleRestoredIfTrigger.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleRestoredIfTrigger.legalActions);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    const opponentTriggers = getLuaRestoreLegalActions(restored, 1).filter((action) => action.type === "activateTrigger");
    expect(opponentTriggers.every((action) => action.windowId === queryPublicState(restored.session).actionWindowId && action.windowKind === "triggerBucket")).toBe(true);
    expect(opponentTriggers.map((action) => action.uid)).toEqual([
      restored.session.state.cards.find((card) => card.controller === 1 && card.location === "graveyard" && card.code === "500")?.uid,
      restored.session.state.cards.find((card) => card.controller === 1 && card.location === "graveyard" && card.code === "500")?.uid,
    ]);
    const opponentWhenTrigger = opponentTriggers.find((action) => {
      const effect = restored.session.state.effects.find((candidate) => candidate.id === action.effectId && candidate.sourceUid === action.uid);
      return effect?.triggerTiming === "when";
    });
    expect(opponentWhenTrigger).toBeDefined();
    expectLuaRestoreStalePreapply(restored, opponentWhenTrigger!, 1);
    applyLuaRestoreAndAssert(restored, opponentWhenTrigger!);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    const opponentIfTrigger = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateTrigger");
    expect(opponentIfTrigger).toMatchObject({ windowId: queryPublicState(restored.session).actionWindowId, windowKind: "triggerBucket" });
    expectLuaRestoreStalePreapply(restored, opponentIfTrigger!, 1);
    applyLuaRestoreAndAssert(restored, opponentIfTrigger!);
    expect(restored.host.messages).toContain("lua opponent when optional resolved");
    expect(restored.host.messages).toContain("lua opponent if optional resolved");
    expect(restored.host.messages).not.toContain("lua when optional resolved");
  });

  it("keeps mandatory Lua triggers through non-terminal movement timing", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Starter", kind: "monster" },
      { code: "500", name: "Lua Moved Body", kind: "monster" },
    ];
    const session = createDuel({ seed: 19, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500", "500"] },
      1: { main: ["500", "500", "500"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local body=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local opponent_body=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, 0, LOCATION_HAND, 1, 1, nil):GetFirst()

      local starter_effect=Effect.CreateEffect(starter)
      starter_effect:SetType(EFFECT_TYPE_IGNITION)
      starter_effect:SetRange(LOCATION_HAND)
      starter_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Duel.SendtoGrave(body, REASON_EFFECT)
        Duel.SendtoGrave(opponent_body, REASON_EFFECT)
        Debug.Message("lua mandatory multistep movement resolved")
      end)
      starter:RegisterEffect(starter_effect)

      local mandatory_effect=Effect.CreateEffect(body)
      mandatory_effect:SetType(EFFECT_TYPE_SINGLE + EFFECT_TYPE_TRIGGER_F)
      mandatory_effect:SetCode(EVENT_TO_GRAVE)
      mandatory_effect:SetRange(LOCATION_GRAVE)
      mandatory_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp) Debug.Message("lua mandatory trigger resolved") end)
      body:RegisterEffect(mandatory_effect)
      `,
      "lua-mandatory-missed-timing-movement.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const starterAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    expect(starterAction).toBeTruthy();
    const activation = applyResponse(session, starterAction!);

    expect(activation.ok).toBe(true);
    expect(host.messages).toContain("lua mandatory multistep movement resolved");
    expect(activation.state.pendingTriggers).toHaveLength(1);
    const mandatoryTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(mandatoryTrigger?.uid).toBe(session.state.cards.find((card) => card.controller === 0 && card.location === "graveyard" && card.code === "500")?.uid);
  });

  it("applies Lua trigger timing to non-terminal deck movements", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Starter", kind: "monster" },
      { code: "500", name: "Lua Field Body", kind: "monster" },
    ];
    const session = createDuel({ seed: 20, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500", "500"] },
      1: { main: ["500", "500", "500"] },
    });
    startDuel(session);
    const body = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(body).toBeTruthy();
    moveDuelCard(session.state, body!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local body=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opponent_body=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, 0, LOCATION_HAND, 1, 1, nil):GetFirst()

      local starter_effect=Effect.CreateEffect(starter)
      starter_effect:SetType(EFFECT_TYPE_IGNITION)
      starter_effect:SetRange(LOCATION_HAND)
      starter_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Duel.SendtoDeck(body, nil, SEQ_DECKTOP, REASON_EFFECT)
        Duel.SendtoGrave(opponent_body, REASON_EFFECT)
        Debug.Message("lua deck movement multistep resolved")
      end)
      starter:RegisterEffect(starter_effect)

      local when_effect=Effect.CreateEffect(body)
      when_effect:SetType(EFFECT_TYPE_SINGLE + EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_LEAVE_FIELD)
      when_effect:SetRange(LOCATION_DECK)
      when_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp) Debug.Message("lua deck when optional resolved") end)
      body:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(body)
      if_effect:SetType(EFFECT_TYPE_SINGLE + EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_LEAVE_FIELD)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_DECK)
      if_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp) Debug.Message("lua deck if optional resolved") end)
      body:RegisterEffect(if_effect)
      `,
      "lua-missed-timing-deck-movement.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const starterAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    expect(starterAction).toBeTruthy();
    const activation = applyResponse(session, starterAction!);

    expect(activation.ok).toBe(true);
    expect(host.messages).toContain("lua deck movement multistep resolved");
    expect(activation.state.pendingTriggers).toHaveLength(1);
    const ifTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(ifTrigger?.uid).toBe(body!.uid);
  });

  it("applies Lua trigger timing to field spell replacement movements", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Starter", kind: "monster" },
      { code: "500", name: "Old Field", kind: "spell", typeFlags: 0x80002 },
      { code: "600", name: "New Field", kind: "spell", typeFlags: 0x80002 },
      { code: "700", name: "Opponent Body", kind: "monster" },
    ];
    const session = createDuel({ seed: 21, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500", "600"] },
      1: { main: ["700"] },
    });
    startDuel(session);
    const oldField = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(oldField).toBeTruthy();
    moveDuelCard(session.state, oldField!.uid, "spellTrapZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local old_field=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      local new_field=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local opponent_body=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 700), 0, 0, LOCATION_HAND, 1, 1, nil):GetFirst()

      local starter_effect=Effect.CreateEffect(starter)
      starter_effect:SetType(EFFECT_TYPE_IGNITION)
      starter_effect:SetRange(LOCATION_HAND)
      starter_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Duel.ActivateFieldSpell(new_field, nil, 0)
        Duel.SendtoGrave(opponent_body, REASON_EFFECT)
        Debug.Message("lua field replacement multistep resolved")
      end)
      starter:RegisterEffect(starter_effect)

      local when_effect=Effect.CreateEffect(old_field)
      when_effect:SetType(EFFECT_TYPE_SINGLE + EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_LEAVE_FIELD)
      when_effect:SetRange(LOCATION_GRAVE)
      when_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp) Debug.Message("lua field when optional resolved") end)
      old_field:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(old_field)
      if_effect:SetType(EFFECT_TYPE_SINGLE + EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_LEAVE_FIELD)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_GRAVE)
      if_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp) Debug.Message("lua field if optional resolved") end)
      old_field:RegisterEffect(if_effect)
      `,
      "lua-missed-timing-field-replacement.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const starterAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    expect(starterAction).toBeTruthy();
    const activation = applyResponse(session, starterAction!);

    expect(activation.ok).toBe(true);
    expect(host.messages).toContain("lua field replacement multistep resolved");
    expect(activation.state.pendingTriggers).toHaveLength(1);
    const ifTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(ifTrigger?.uid).toBe(oldField!.uid);
  });

  it("applies Lua trigger timing across equip movement steps", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Starter", kind: "monster" },
      { code: "500", name: "Lua Trigger Body", kind: "monster" },
      { code: "600", name: "Lua Equip Spell", kind: "spell", typeFlags: 0x2 },
      { code: "700", name: "Lua Equip Target", kind: "monster" },
      { code: "800", name: "Opponent Body", kind: "monster" },
    ];
    const session = createDuel({ seed: 22, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500", "600", "700"] },
      1: { main: ["800"] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "700");
    expect(target).toBeTruthy();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local body=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local equip_spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local equip_target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 700), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opponent_body=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 800), 0, 0, LOCATION_HAND, 1, 1, nil):GetFirst()

      local starter_effect=Effect.CreateEffect(starter)
      starter_effect:SetType(EFFECT_TYPE_IGNITION)
      starter_effect:SetRange(LOCATION_HAND)
      starter_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Duel.SendtoGrave(body, REASON_EFFECT)
        Duel.Equip(0, equip_spell, equip_target)
        Duel.SendtoGrave(opponent_body, REASON_EFFECT)
        Debug.Message("lua equip multistep resolved")
      end)
      starter:RegisterEffect(starter_effect)

      local when_effect=Effect.CreateEffect(body)
      when_effect:SetType(EFFECT_TYPE_SINGLE + EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_TO_GRAVE)
      when_effect:SetRange(LOCATION_GRAVE)
      when_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp) Debug.Message("lua equip when optional resolved") end)
      body:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(body)
      if_effect:SetType(EFFECT_TYPE_SINGLE + EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_TO_GRAVE)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_GRAVE)
      if_effect:SetOperation(function(e,tp,eg,ep,ev,re,r,rp) Debug.Message("lua equip if optional resolved") end)
      body:RegisterEffect(if_effect)
      `,
      "lua-missed-timing-equip-movement.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const starterAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    expect(starterAction).toBeTruthy();
    const activation = applyResponse(session, starterAction!);

    expect(activation.ok).toBe(true);
    expect(host.messages).toContain("lua equip multistep resolved");
    expect(activation.state.pendingTriggers).toHaveLength(1);
    const ifTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(ifTrigger?.uid).toBe(session.state.cards.find((card) => card.controller === 0 && card.location === "graveyard" && card.code === "500")?.uid);
  });

});

function expectGroupedActionsToContainLegalActions(result: ReturnType<typeof applyLuaRestoreResponse>): void {
  const groupedActions = result.legalActionGroups.flatMap((group) => group.actions);
  expect(groupedActions).toHaveLength(result.legalActions.length);
  expect(groupedActions).toEqual(expect.arrayContaining(result.legalActions));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  const publicState = queryPublicState(restored.session);
  expect(response.ok, response.error).toBe(true);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(response.state).not.toHaveProperty("triggerOrderPrompt");
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expectGroupedActionsToContainLegalActions(response);
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function expectLuaRestoreStalePreapply(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1], player: 0 | 1): void {
  const response = applyLuaRestoreResponse(restored, { ...action, windowId: action.windowId! - 1 });
  const publicState = queryPublicState(restored.session);
  expect(response.ok).toBe(false);
  expect(response.error).toContain("Response is not currently legal");
  expect(response.state.actionWindowId).toBe(restored.session.state.actionWindowId);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(response.state).not.toHaveProperty("triggerOrderPrompt");
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expectGroupedActionsToContainLegalActions(response);
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
