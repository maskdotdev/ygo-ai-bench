import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua field movement helpers", () => {
  it("preserves active Lua reason source metadata for MoveToField move events", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "MoveToField Reason Source", kind: "monster" },
      { code: "200", name: "MoveToField Reason Target", kind: "monster" },
      { code: "300", name: "MoveToField Reason Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 290, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source_effect=nil
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local target=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
          Duel.MoveToField(target, tp, tp, LOCATION_MZONE, POS_FACEUP_ATTACK, true)
          Debug.Message("move field reason source " .. tostring(target:GetReasonCard()==c) .. "/" .. tostring(target:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_MOVE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          local moved=eg:GetFirst()
          Debug.Message("move field event reason source " .. tostring(moved:GetReasonCard():IsCode(100)) .. "/" .. tostring(moved:GetReasonEffect()==source_effect))
        end)
        c:RegisterEffect(e)
      end
      `,
      "move-to-field-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const source = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    const watcher = session.state.cards.find((card) => card.code === "300");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    expect(watcher).toBeDefined();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("move field reason source true/true");
    expect(session.state.pendingTriggers).toContainEqual(
      expect.objectContaining({ eventName: "moved", eventCardUid: target!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }),
    );
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === watcher!.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("move field event reason source true/true");
  });

  it("preserves active Lua reason source metadata for ReturnToField move events", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "ReturnToField Reason Source", kind: "monster" },
      { code: "200", name: "ReturnToField Reason Target", kind: "monster" },
      { code: "300", name: "ReturnToField Reason Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 291, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "200");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
    moveDuelCard(session.state, target!.uid, "banished", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source_effect=nil
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local target=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_REMOVED, 0, 1, 1, nil):GetFirst()
          Duel.ReturnToField(target, POS_FACEUP_DEFENSE)
          Debug.Message("return field reason source " .. tostring(target:GetReasonCard()==c) .. "/" .. tostring(target:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_MOVE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          local moved=eg:GetFirst()
          Debug.Message("return field event reason source " .. tostring(moved:GetReasonCard():IsCode(100)) .. "/" .. tostring(moved:GetReasonEffect()==source_effect))
        end)
        c:RegisterEffect(e)
      end
      `,
      "return-to-field-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const source = session.state.cards.find((card) => card.code === "100");
    const watcher = session.state.cards.find((card) => card.code === "300");
    expect(source).toBeDefined();
    expect(watcher).toBeDefined();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("return field reason source true/true");
    expect(session.state.pendingTriggers).toContainEqual(
      expect.objectContaining({ eventName: "moved", eventCardUid: target!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }),
    );
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === watcher!.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("return field event reason source true/true");
  });

  it("preserves active Lua reason source metadata for ActivateFieldSpell move events", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "ActivateFieldSpell Reason Source", kind: "monster" },
      { code: "200", name: "ActivateFieldSpell Reason Target", kind: "spell", typeFlags: 0x80002 },
      { code: "300", name: "ActivateFieldSpell Reason Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 292, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source_effect=nil
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local target=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
          Duel.ActivateFieldSpell(target, nil, tp)
          Debug.Message("activate field spell reason source " .. tostring(target:GetReasonCard()==c) .. "/" .. tostring(target:GetReasonEffect()==source_effect))
        end)
        source_effect=e
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_MOVE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          local moved=eg:GetFirst()
          Debug.Message("activate field spell event reason source " .. tostring(moved:GetReasonCard():IsCode(100)) .. "/" .. tostring(moved:GetReasonEffect()==source_effect))
        end)
        c:RegisterEffect(e)
      end
      `,
      "activate-field-spell-reason-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const source = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    const watcher = session.state.cards.find((card) => card.code === "300");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    expect(watcher).toBeDefined();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("activate field spell reason source true/true");
    expect(session.state.pendingTriggers).toContainEqual(
      expect.objectContaining({ eventName: "moved", eventCardUid: target!.uid, eventReasonCardUid: source!.uid, eventReasonEffectId: 1 }),
    );
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === watcher!.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("activate field spell event reason source true/true");
  });

  it("lets Lua scripts move cards onto field zones", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Filler A", kind: "monster" },
      { code: "200", name: "Field Filler B", kind: "monster" },
      { code: "300", name: "Field Filler C", kind: "monster" },
      { code: "400", name: "Field Filler D", kind: "monster" },
      { code: "500", name: "Field Filler E", kind: "monster" },
      { code: "600", name: "Moved Monster", kind: "monster" },
      { code: "650", name: "Masked Monster", kind: "monster" },
      { code: "660", name: "Blocked Masked Monster", kind: "monster" },
      { code: "700", name: "Blocked Monster", kind: "monster" },
      { code: "750", name: "Occupied Pendulum Slot", kind: "spell", typeFlags: 0x1000002 },
      { code: "800", name: "Moved Pendulum Spell", kind: "spell", typeFlags: 0x1000002 },
      { code: "820", name: "Moved Field Spell", kind: "spell", typeFlags: 0x80002 },
      { code: "830", name: "Moved Trap", kind: "trap", typeFlags: 0x4 },
      { code: "850", name: "Blocked Pendulum Spell", kind: "spell", typeFlags: 0x1000002 },
      { code: "900", name: "Invalid Move", kind: "monster" },
    ];
    const session = createDuel({ seed: 99, startingHandSize: 15, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600", "650", "660", "700", "750", "800", "820", "830", "850", "900"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["100", "200", "300", "400", "500"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    const occupiedScale = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "750");
    moveDuelCard(session.state, occupiedScale!.uid, "spellTrapZone", 0).sequence = 1;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local masked_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 650), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local blocked_masked = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 660), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local blocked = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 700), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 800), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local field_spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 820), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local trap = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 830), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local blocked_spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 850), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local invalid = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("move to opponent mzone " .. Duel.MoveToField(monster, 0, 1, LOCATION_MZONE, POS_FACEUP_ATTACK, true))
      Debug.Message("move mzone sequence " .. monster:GetSequence())
      Debug.Message("move field operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("move masked mzone " .. Duel.MoveToField(masked_monster, 0, 1, LOCATION_MZONE, POS_FACEUP_DEFENSE, true, 4))
      Debug.Message("move masked mzone sequence " .. masked_monster:GetSequence() .. "/" .. tostring(masked_monster:IsLocation(LOCATION_MMZONE)))
      Debug.Message("move occupied masked mzone " .. Duel.MoveToField(blocked_masked, 0, 1, LOCATION_MZONE, POS_FACEUP_ATTACK, true, 4))
      Debug.Message("move occupied masked operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("move blocked full " .. Duel.MoveToField(blocked, 0, 0, LOCATION_MZONE, POS_FACEUP_ATTACK, true))
      Debug.Message("move blocked operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("move to szone " .. Duel.MoveToField(spell, 0, 0, LOCATION_PZONE, POS_FACEDOWN_DEFENSE, true, 1))
      Debug.Message("move szone sequence " .. spell:GetSequence() .. "/" .. tostring(spell:IsLocation(LOCATION_PZONE)))
      Debug.Message("move szone operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("move to fzone " .. Duel.MoveToField(field_spell, 0, 0, LOCATION_FZONE, POS_FACEUP, true))
      Debug.Message("move fzone location " .. tostring(field_spell:IsLocation(LOCATION_FZONE)) .. "/" .. tostring(field_spell:IsLocation(LOCATION_STZONE)))
      Debug.Message("move to stzone " .. Duel.MoveToField(trap, 0, 0, LOCATION_STZONE, POS_FACEDOWN_DEFENSE, true))
      Debug.Message("move stzone location " .. tostring(trap:IsLocation(LOCATION_STZONE)) .. "/" .. tostring(trap:IsLocation(LOCATION_FZONE)) .. "/" .. tostring(trap:IsLocation(LOCATION_PZONE)))
      Debug.Message("move occupied pzone " .. Duel.MoveToField(blocked_spell, 0, 0, LOCATION_PZONE, POS_FACEUP, true, 2))
      Debug.Message("move occupied operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("move invalid dest " .. Duel.MoveToField(invalid, 0, 0, LOCATION_GRAVE, POS_FACEUP_ATTACK, true))
      Debug.Message("move invalid operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "move-to-field.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("move to opponent mzone 1");
    expect(host.messages).toContain("move mzone sequence 0");
    expect(host.messages).toContain("move field operated 1/600");
    expect(host.messages).toContain("move masked mzone 1");
    expect(host.messages).toContain("move masked mzone sequence 2/true");
    expect(host.messages).toContain("move occupied masked mzone 0");
    expect(host.messages).toContain("move occupied masked operated 0");
    expect(host.messages).toContain("move blocked full 0");
    expect(host.messages).toContain("move blocked operated 0");
    expect(host.messages).toContain("move to szone 1");
    expect(host.messages).toContain("move szone sequence 0/true");
    expect(host.messages).toContain("move szone operated 1/800");
    expect(host.messages).toContain("move to fzone 1");
    expect(host.messages).toContain("move fzone location true/false");
    expect(host.messages).toContain("move to stzone 1");
    expect(host.messages).toContain("move stzone location true/false/false");
    expect(host.messages).toContain("move occupied pzone 0");
    expect(host.messages).toContain("move occupied operated 0");
    expect(host.messages).toContain("move invalid dest 0");
    expect(host.messages).toContain("move invalid operated 0");
    expect(session.state.cards.find((card) => card.code === "600")).toMatchObject({ controller: 1, location: "monsterZone", position: "faceUpAttack", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "650")).toMatchObject({ controller: 1, location: "monsterZone", sequence: 2, position: "faceUpDefense", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "660")).toMatchObject({ controller: 0, location: "hand" });
    expect(session.state.cards.find((card) => card.code === "700")).toMatchObject({ controller: 0, location: "hand" });
    expect(session.state.cards.find((card) => card.code === "750")).toMatchObject({ controller: 0, location: "spellTrapZone", sequence: 1 });
    expect(session.state.cards.find((card) => card.code === "800")).toMatchObject({ controller: 0, location: "spellTrapZone", position: "faceDownDefense", faceUp: false });
    expect(session.state.cards.find((card) => card.code === "820")).toMatchObject({ controller: 0, location: "spellTrapZone", position: "faceUpAttack", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "830")).toMatchObject({ controller: 0, location: "spellTrapZone", position: "faceDownDefense", faceUp: false });
    expect(session.state.cards.find((card) => card.code === "850")).toMatchObject({ controller: 0, location: "hand" });
    expect(session.state.cards.find((card) => card.code === "900")).toMatchObject({ controller: 0, location: "hand" });
  });

  it("lets Lua scripts return cards to their previous field zones", () => {
    const cards: DuelCardData[] = [
      { code: "50", name: "Return Filler A", kind: "monster" },
      { code: "60", name: "Return Filler B", kind: "monster" },
      { code: "100", name: "Return Monster", kind: "monster" },
      { code: "200", name: "Return Override", kind: "monster" },
      { code: "300", name: "No Previous Field", kind: "monster" },
    ];
    const session = createDuel({ seed: 100, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["50", "100", "60", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const code of ["50", "100", "60"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    const first = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "monsterZone" && candidate.code === "100");
    const second = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "200");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    first!.position = "faceUpAttack";
    first!.faceUp = true;
    moveDuelCard(session.state, first!.uid, "banished", 0);
    moveDuelCard(session.state, second!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, second!.uid, "banished", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local first = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_REMOVED, 0, 1, 1, nil):GetFirst()
      local second = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_REMOVED, 0, 1, 1, nil):GetFirst()
      local invalid = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("return field first " .. tostring(Duel.ReturnToField(first)))
      Debug.Message("return sequence first " .. first:GetSequence())
      Debug.Message("return operated first " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("return field second " .. tostring(Duel.ReturnToField(second, POS_FACEUP_DEFENSE)))
      Debug.Message("return operated second " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("return invalid " .. tostring(Duel.ReturnToField(invalid)))
      Debug.Message("return operated invalid " .. Duel.GetOperatedGroup():GetCount())
      `,
      "return-to-field.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("return field first true");
    expect(host.messages).toContain("return sequence first 1");
    expect(host.messages).toContain("return operated first 1/100");
    expect(host.messages).toContain("return field second true");
    expect(host.messages).toContain("return operated second 1/200");
    expect(host.messages).toContain("return invalid false");
    expect(host.messages).toContain("return operated invalid 0");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ controller: 0, location: "monsterZone", sequence: 2, position: "faceUpAttack", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "60")).toMatchObject({ controller: 0, location: "monsterZone", sequence: 4 });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ controller: 0, location: "monsterZone", sequence: 1, position: "faceUpDefense", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ controller: 0, location: "hand" });
  });

  it("lets Lua scripts return Pendulum cards to previous spell/trap field zones", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Pendulum Filler A", kind: "spell", typeFlags: 0x1000002 },
      { code: "200", name: "Returned Pendulum", kind: "spell", typeFlags: 0x1000002 },
      { code: "300", name: "Pendulum Filler B", kind: "spell", typeFlags: 0x1000002 },
    ];
    const session = createDuel({ seed: 101, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const code of ["100", "200", "300"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "spellTrapZone", 0);
    }
    const returned = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "spellTrapZone" && candidate.code === "200");
    moveDuelCard(session.state, returned!.uid, "banished", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local returned = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_REMOVED, 0, 1, 1, nil):GetFirst()
      Debug.Message("return pendulum " .. tostring(Duel.ReturnToField(returned, POS_FACEUP)))
      Debug.Message("return pendulum sequence " .. returned:GetSequence() .. "/" .. tostring(returned:IsLocation(LOCATION_PZONE)))
      Debug.Message("return pendulum operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "return-pendulum-to-field.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("return pendulum true");
    expect(host.messages).toContain("return pendulum sequence 1/true");
    expect(host.messages).toContain("return pendulum operated 1");
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ controller: 0, location: "spellTrapZone", sequence: 1, position: "faceUpAttack", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ controller: 0, location: "spellTrapZone", sequence: 3 });
  });

  it("lets Lua scripts return field spells to previous field zones", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Returned Field Spell", kind: "spell", typeFlags: 0x80002 }];
    const session = createDuel({ seed: 102, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const field = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "100");
    moveDuelCard(session.state, field!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, field!.uid, "banished", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local field = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_REMOVED, 0, 1, 1, nil):GetFirst()
      Debug.Message("return field spell " .. tostring(Duel.ReturnToField(field, POS_FACEUP)))
      Debug.Message("return fzone location " .. field:GetSequence() .. "/" .. tostring(field:IsLocation(LOCATION_FZONE)) .. "/" .. tostring(field:IsLocation(LOCATION_STZONE)))
      Debug.Message("return fzone operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "return-field-spell.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("return field spell true");
    expect(host.messages).toContain("return fzone location 0/true/false");
    expect(host.messages).toContain("return fzone operated 1");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ controller: 0, location: "spellTrapZone", sequence: 0, position: "faceUpAttack", faceUp: true });
  });

  it("lets Lua scripts return regular spell/trap cards to previous spell/trap zones", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Returned Trap", kind: "trap", typeFlags: 0x4 }];
    const session = createDuel({ seed: 103, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const trap = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "100");
    moveDuelCard(session.state, trap!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, trap!.uid, "banished", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local trap = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_REMOVED, 0, 1, 1, nil):GetFirst()
      Debug.Message("return stzone " .. tostring(Duel.ReturnToField(trap, POS_FACEDOWN_DEFENSE)))
      Debug.Message("return stzone location " .. trap:GetSequence() .. "/" .. tostring(trap:IsLocation(LOCATION_STZONE)) .. "/" .. tostring(trap:IsLocation(LOCATION_FZONE)) .. "/" .. tostring(trap:IsLocation(LOCATION_PZONE)))
      Debug.Message("return stzone operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "return-trap-to-field.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("return stzone true");
    expect(host.messages).toContain("return stzone location 0/true/false/false");
    expect(host.messages).toContain("return stzone operated 1");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ controller: 0, location: "spellTrapZone", sequence: 0, position: "faceDownDefense", faceUp: false });
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
