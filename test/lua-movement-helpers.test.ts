import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  applyResponse,
  createDuel,
  detachDuelOverlayMaterials,
  destroyDuelCard,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  specialSummonDuelCard,
  startDuel,
  xyzSummonDuelCard,
} from "#duel/core.js";
import { getCards, moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua movement helpers", () => {
  it("lets Lua scripts remove cards from the duel", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Removed From Duel A", kind: "monster" },
      { code: "200", name: "Removed From Duel B", kind: "monster" },
      { code: "300", name: "Remaining Field", kind: "monster" },
    ];
    const session = createDuel({ seed: 94, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local remove_group = Duel.GetMatchingGroup(function(c) return c:IsCode(100) or c:IsCode(200) end, 0, LOCATION_MZONE, 0, nil)
      Debug.Message("remove cards result " .. Duel.RemoveCards(remove_group, 0, -2, REASON_RULE))
      Debug.Message("remove cards operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("remove cards field " .. Duel.GetFieldGroupCount(0, LOCATION_MZONE, 0))
      Debug.Message("remove cards hidden " .. Duel.GetMatchingGroupCount(function(c) return c:IsCode(100) or c:IsCode(200) end, 0, LOCATION_MZONE + LOCATION_GRAVE + LOCATION_REMOVED, 0, nil))
      `,
      "remove-cards.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("remove cards result 2");
    expect(host.messages).toContain("remove cards operated 2");
    expect(host.messages).toContain("remove cards field 1");
    expect(host.messages).toContain("remove cards hidden 0");
    expect(session.state.cards.map((card) => card.code).sort()).toEqual(["300"]);
  });

  it("lets Lua scripts banish cards face-down with the third-argument reason", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Hidden Banish", kind: "monster" }];
    const session = createDuel({ seed: 95, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "100");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      Debug.Message("removed face-down " .. Duel.Remove(c, POS_FACEDOWN_DEFENSE, REASON_EFFECT))
      Debug.Message("removed state " .. tostring(c:IsLocation(LOCATION_REMOVED)) .. "/" .. tostring(c:IsFacedown()) .. "/" .. tostring(c:IsPublic()) .. "/" .. c:GetReason())
      `,
      "face-down-remove.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("removed face-down 1");
    expect(host.messages).toContain("removed state true/true/false/64");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({
      faceUp: false,
      location: "banished",
      position: "faceDownDefense",
      reason: 0x40,
    });
  });

  it("raises Lua leave-field triggers for cards moved from the field by effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Leave Field Mover", kind: "monster" },
      { code: "200", name: "Leaving Monster", kind: "monster" },
      { code: "300", name: "Leave Field Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 97, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const mover = session.state.cards.find((card) => card.code === "100");
    const leaving = session.state.cards.find((card) => card.code === "200");
    expect(mover).toBeDefined();
    expect(leaving).toBeDefined();
    moveDuelCard(session.state, mover!.uid, "monsterZone", 0);
    moveDuelCard(session.state, leaving!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetOperation(function(e,tp)
          local g=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_MZONE, 0, 1, 1, nil)
          Duel.SendtoGrave(g, REASON_EFFECT)
        end)
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_LEAVE_FIELD)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          local tc=eg:GetFirst()
          return tc and tc:IsCode(200) and tc:IsPreviousLocation(LOCATION_MZONE) and tc:IsReason(REASON_EFFECT)
        end)
        e:SetOperation(function(e,tp,eg)
          local tc=eg:GetFirst()
          Debug.Message("left field trigger " .. tc:GetCode() .. "/" .. tc:GetLeaveFieldDest())
        end)
        c:RegisterEffect(e)
      end
      `,
      "leave-field-trigger.lua",
    );

    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === mover!.uid);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid !== mover!.uid);
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(host.messages).toContain("left field trigger 200/16");
  });

  it("lets Corrupted Ritual Records set itself from the GY after a listed monster leaves by effect", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Leave Field Mover", kind: "monster" },
      { code: "24461358", name: "Corrupted Ritual Records", kind: "trap" },
      { code: "70405001", name: "Listed Ritual Monster", kind: "monster", listedNames: ["33599853"] },
    ];
    const session = createDuel({ seed: 162, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "24461358", "70405001"] },
      1: { main: [] },
    });
    startDuel(session);
    const mover = session.state.cards.find((card) => card.code === "100");
    const record = session.state.cards.find((card) => card.code === "24461358");
    const listed = session.state.cards.find((card) => card.code === "70405001");
    expect(mover).toBeTruthy();
    expect(record).toBeTruthy();
    expect(listed).toBeTruthy();
    moveDuelCard(session.state, mover!.uid, "monsterZone", 0);
    moveDuelCard(session.state, record!.uid, "graveyard", 0);
    moveDuelCard(session.state, listed!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetOperation(function(e,tp)
          local g=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 70405001), tp, LOCATION_MZONE, 0, 1, 1, nil)
          Duel.SendtoGrave(g, REASON_EFFECT)
        end)
        c:RegisterEffect(e)
      end
      `,
      "corrupted-records-mover.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    const fallback = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c24461358.lua", "utf8"), "c24461358.lua");
    expect(fallback.ok, fallback.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const moveAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === mover!.uid);
    expect(moveAction).toBeDefined();
    expect(applyResponse(session, moveAction!).ok).toBe(true);
    const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === record!.uid);
    expect(setAction).toBeDefined();
    expect(applyResponse(session, setAction!).ok).toBe(true);

    expect(session.state.cards.find((card) => card.uid === listed!.uid)).toMatchObject({ location: "graveyard", reason: 0x40 });
    expect(session.state.cards.find((card) => card.uid === record!.uid)).toMatchObject({ location: "spellTrapZone", position: "faceDown", faceUp: false });
  });

  it("loads Gurifoh and sets a listed Spell/Trap from Deck", () => {
    const cards: DuelCardData[] = [
      { code: "97462632", name: "Gurifoh", kind: "monster" },
      { code: "24461358", name: "Corrupted Ritual Records", kind: "trap", listedNames: ["33599853"] },
    ];
    const session = createDuel({ seed: 98, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["97462632", "24461358"] },
      1: { main: [] },
    });
    startDuel(session);

    const gurifoh = session.state.cards.find((card) => card.code === "97462632");
    const records = session.state.cards.find((card) => card.code === "24461358");
    expect(gurifoh).toBeDefined();
    expect(records).toBeDefined();
    moveDuelCard(session.state, gurifoh!.uid, "hand", 0);
    moveDuelCard(session.state, records!.uid, "deck", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c97462632.lua", "utf8"), "c97462632.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === gurifoh!.uid);
    expect(setAction).toBeDefined();
    expect(applyResponse(session, setAction!).ok).toBe(true);
    while (session.state.chain.length > 0) {
      const player = session.state.waitingFor ?? session.state.turnPlayer;
      expect(applyResponse(session, { type: "passChain", player, label: "Pass" }).ok).toBe(true);
    }

    expect(session.state.cards.find((card) => card.uid === gurifoh!.uid)).toMatchObject({ location: "graveyard", reason: 0x4080 });
    expect(session.state.cards.find((card) => card.uid === records!.uid)).toMatchObject({
      location: "spellTrapZone",
      position: "faceDown",
      faceUp: false,
    });
  });

  it("loads Mystical Celtic Sage and tributes itself to summon a listed Ritual monster", () => {
    const cards: DuelCardData[] = [
      { code: "50073633", name: "Mystical Celtic Sage", kind: "monster" },
      { code: "70405001", name: "Black Luster Soldier - Soldier of Light and Darkness", kind: "monster", typeFlags: 0x81, listedNames: ["33599853"] },
    ];
    const session = createDuel({ seed: 99, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["50073633", "70405001"] },
      1: { main: [] },
    });
    startDuel(session);

    const sage = session.state.cards.find((card) => card.code === "50073633");
    const ritual = session.state.cards.find((card) => card.code === "70405001");
    expect(sage).toBeDefined();
    expect(ritual).toBeDefined();
    moveDuelCard(session.state, sage!.uid, "monsterZone", 0);
    moveDuelCard(session.state, ritual!.uid, "hand", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c50073633.lua", "utf8"), "c50073633.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const summonAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sage!.uid);
    expect(summonAction).toBeDefined();
    expect(applyResponse(session, summonAction!).ok).toBe(true);
    while (session.state.chain.length > 0) {
      const player = session.state.waitingFor ?? session.state.turnPlayer;
      expect(applyResponse(session, { type: "passChain", player, label: "Pass" }).ok).toBe(true);
    }

    expect(session.state.cards.find((card) => card.uid === sage!.uid)).toMatchObject({ location: "graveyard", reason: 0x82 });
    expect(session.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
  });

  it("loads Skull Archfiend of Chaos and recycles cards before summoning itself", () => {
    const cards: DuelCardData[] = [
      { code: "24088928", name: "Skull Archfiend of Chaos", kind: "monster" },
      { code: "33599853", name: "Ritual of Light and Darkness", kind: "spell" },
      { code: "100", name: "Recycle Grave", kind: "monster" },
      { code: "200", name: "Recycle Banished", kind: "monster" },
    ];
    const session = createDuel({ seed: 100, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["24088928", "33599853", "100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "24088928");
    const ritualSpell = session.state.cards.find((card) => card.code === "33599853");
    const grave = session.state.cards.find((card) => card.code === "100");
    const banished = session.state.cards.find((card) => card.code === "200");
    expect(source).toBeDefined();
    expect(ritualSpell).toBeDefined();
    expect(grave).toBeDefined();
    expect(banished).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, ritualSpell!.uid, "graveyard", 0);
    moveDuelCard(session.state, grave!.uid, "graveyard", 0);
    moveDuelCard(session.state, banished!.uid, "banished", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c24088928.lua", "utf8"), "c24088928.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    while (session.state.chain.length > 0) {
      const player = session.state.waitingFor ?? session.state.turnPlayer;
      expect(applyResponse(session, { type: "passChain", player, label: "Pass" }).ok).toBe(true);
    }

    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    for (const card of [ritualSpell, grave, banished]) {
      expect(session.state.cards.find((candidate) => candidate.uid === card!.uid)).toMatchObject({ location: "deck", reason: 0x40 });
    }
  });

  it("loads Skull Archfiend of Chaos and searches after being sent to the GY", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Skull Sender", kind: "monster" },
      { code: "24088928", name: "Skull Archfiend of Chaos", kind: "monster" },
      { code: "33599853", name: "Ritual of Light and Darkness", kind: "spell" },
      { code: "70405001", name: "Black Luster Soldier - Soldier of Light and Darkness", kind: "monster", typeFlags: 0x81 },
    ];
    const session = createDuel({ seed: 101, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "24088928", "33599853", "70405001"] },
      1: { main: [] },
    });
    startDuel(session);

    const sender = session.state.cards.find((card) => card.code === "100");
    const source = session.state.cards.find((card) => card.code === "24088928");
    const ritualSpell = session.state.cards.find((card) => card.code === "33599853");
    const ritualMonster = session.state.cards.find((card) => card.code === "70405001");
    expect(sender).toBeDefined();
    expect(source).toBeDefined();
    expect(ritualSpell).toBeDefined();
    expect(ritualMonster).toBeDefined();
    moveDuelCard(session.state, sender!.uid, "monsterZone", 0);
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    moveDuelCard(session.state, ritualSpell!.uid, "deck", 0);
    moveDuelCard(session.state, ritualMonster!.uid, "deck", 0);

    const host = createLuaScriptHost(session);
    const mover = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetOperation(function(e,tp)
          local g=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 24088928), tp, LOCATION_MZONE, 0, 1, 1, nil)
          Duel.SendtoGrave(g, REASON_EFFECT)
        end)
        c:RegisterEffect(e)
      end
      `,
      "skull-archfiend-sender.lua",
    );
    expect(mover.ok, mover.error).toBe(true);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c24088928.lua", "utf8"), "c24088928.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const sendAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sender!.uid);
    expect(sendAction).toBeDefined();
    expect(applyResponse(session, sendAction!).ok).toBe(true);
    const triggerAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === source!.uid);
    expect(triggerAction).toBeDefined();
    expect(applyResponse(session, triggerAction!).ok).toBe(true);

    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "graveyard", reason: 0x40 });
    expect(session.state.cards.find((card) => card.uid === ritualSpell!.uid)).toMatchObject({ location: "graveyard", reason: 0x40 });
    expect(session.state.cards.find((card) => card.uid === ritualMonster!.uid)).toMatchObject({ location: "hand", reason: 0x40 });
  });

  it("loads Black Chaos the Dark Chaos Magician and banishes an opponent card face-down", () => {
    const cards: DuelCardData[] = [
      { code: "44001993", name: "Black Chaos the Dark Chaos Magician", kind: "monster" },
      { code: "100", name: "Opponent Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 102, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["44001993"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "44001993");
    const target = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c44001993.lua", "utf8"), "c44001993.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    while (session.state.chain.length > 0) {
      const player = session.state.waitingFor ?? session.state.turnPlayer;
      expect(applyResponse(session, { type: "passChain", player, label: "Pass" }).ok).toBe(true);
    }

    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "banished",
      position: "faceDownDefense",
      faceUp: false,
      reason: 0x40,
    });
  });

  it("loads Mind Shuffle and searches a listed monster before discarding", () => {
    const cards: DuelCardData[] = [
      { code: "24749710", name: "Mind Shuffle", kind: "spell" },
      { code: "70405001", name: "Black Luster Soldier - Soldier of Light and Darkness", kind: "monster", listedNames: ["33599853"] },
      { code: "100", name: "Discard Fodder", kind: "monster" },
    ];
    const session = createDuel({ seed: 103, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["24749710", "70405001", "100"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "24749710");
    const searched = session.state.cards.find((card) => card.code === "70405001");
    const fodder = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    expect(searched).toBeDefined();
    expect(fodder).toBeDefined();
    moveDuelCard(session.state, source!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, searched!.uid, "deck", 0);
    moveDuelCard(session.state, fodder!.uid, "hand", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c24749710.lua", "utf8"), "c24749710.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid && session.state.effects.find((effect) => effect.id === candidate.effectId)?.category === 0x20088);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    while (session.state.chain.length > 0) {
      const player = session.state.waitingFor ?? session.state.turnPlayer;
      expect(applyResponse(session, { type: "passChain", player, label: "Pass" }).ok).toBe(true);
    }

    expect(session.state.cards.find((card) => card.uid === searched!.uid)).toMatchObject({ location: "hand", reason: 0x40 });
    expect(session.state.cards.find((card) => card.uid === fodder!.uid)).toMatchObject({ location: "graveyard", reason: 0x4040 });
  });

  it("loads Black Luster Soldier and banishes an opponent card after Special Summon", () => {
    const cards: DuelCardData[] = [
      { code: "70405001", name: "Black Luster Soldier - Soldier of Light and Darkness", kind: "monster" },
      { code: "100", name: "Opponent Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 104, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["70405001"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "70405001");
    const target = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c70405001.lua", "utf8"), "c70405001.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    specialSummonDuelCard(session.state, source!.uid, 0);
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === source!.uid);
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);

    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "banished",
      faceUp: true,
      reason: 0x40,
    });
  });

  it("loads Phantom Knights Doomed Solleret and sets a Phantom Knights Spell/Trap from Deck", () => {
    const cards: DuelCardData[] = [
      { code: "101305019", name: "The Phantom Knights of Doomed Solleret", kind: "monster", setcodes: [0xdb] },
      { code: "100", name: "Phantom Knights Trap", kind: "trap", setcodes: [0xdb] },
    ];
    const session = createDuel({ seed: 107, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101305019", "100"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "101305019");
    const trap = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    expect(trap).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, trap!.uid, "deck", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c101305019.lua", "utf8"), "c101305019.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === source!.uid);
    expect(summon).toBeDefined();
    expect(applyResponse(session, summon!).ok).toBe(true);
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === source!.uid);
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);

    expect(session.state.cards.find((card) => card.uid === trap!.uid)).toMatchObject({
      location: "spellTrapZone",
      position: "faceDown",
      faceUp: false,
    });
  });

  it("loads Phantom Knights Doomed Solleret and raises targeted Level and Rank from the GY", () => {
    const cards: DuelCardData[] = [
      { code: "101305019", name: "The Phantom Knights of Doomed Solleret", kind: "monster", setcodes: [0xdb] },
      { code: "100", name: "Dark Level Target", kind: "monster", level: 3, attribute: 0x20 },
      { code: "200", name: "Dark Rank Target", kind: "extra", typeFlags: 0x800001, level: 3, attribute: 0x20 },
    ];
    const session = createDuel({ seed: 112, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101305019", "100"], extra: ["200"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "101305019");
    const levelTarget = session.state.cards.find((card) => card.code === "100");
    const rankTarget = session.state.cards.find((card) => card.code === "200");
    expect(source).toBeDefined();
    expect(levelTarget).toBeDefined();
    expect(rankTarget).toBeDefined();
    moveDuelCard(session.state, source!.uid, "graveyard", 0);
    moveDuelCard(session.state, levelTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, rankTarget!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c101305019.lua", "utf8"), "c101305019.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    const probe = host.loadScript(
      `
      local lv=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local rk=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,200),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("phantom level rank " .. lv:GetLevel() .. "/" .. rk:GetRank())
      `,
      "phantom-level-rank-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(host.messages).toContain("phantom level rank 4/4");
    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({
      location: "banished",
      reason: 0x80,
    });
  });

  it("loads Phantom Knights Decayed Cloak and searches a Phantom Knights monster from Deck", () => {
    const cards: DuelCardData[] = [
      { code: "101305018", name: "The Phantom Knights of Decayed Cloak", kind: "monster", setcodes: [0xdb] },
      { code: "100", name: "Phantom Knights Monster", kind: "monster", setcodes: [0xdb] },
    ];
    const session = createDuel({ seed: 108, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101305018", "100"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "101305018");
    const searched = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    expect(searched).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, searched!.uid, "deck", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c101305018.lua", "utf8"), "c101305018.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === source!.uid);
    expect(summon).toBeDefined();
    expect(applyResponse(session, summon!).ok).toBe(true);
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === source!.uid);
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);

    expect(session.state.cards.find((card) => card.uid === searched!.uid)).toMatchObject({
      location: "hand",
      controller: 0,
    });
  });

  it("loads Phantom Knights Decayed Cloak and special summons itself by revealing another Phantom Knights card", () => {
    const cards: DuelCardData[] = [
      { code: "101305018", name: "The Phantom Knights of Decayed Cloak", kind: "monster", setcodes: [0xdb] },
      { code: "100", name: "Phantom Knights Reveal", kind: "trap", setcodes: [0xdb] },
    ];
    const session = createDuel({ seed: 109, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101305018", "100"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "101305018");
    const revealed = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    expect(revealed).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, revealed!.uid, "hand", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c101305018.lua", "utf8"), "c101305018.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(session.state.cards.find((card) => card.uid === revealed!.uid)).toMatchObject({
      location: "hand",
      controller: 0,
    });
  });

  it("loads Phantom Knights Malevolent Scythe and detaches material to summon from Deck", () => {
    const cards: DuelCardData[] = [
      { code: "101305037", name: "The Phantom Knights of Malevolent Scythe", kind: "extra", setcodes: [0xdb] },
      { code: "100", name: "Phantom Knights Summon", kind: "monster", setcodes: [0xdb] },
      { code: "200", name: "Overlay Material", kind: "monster" },
    ];
    const session = createDuel({ seed: 110, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"], extra: ["101305037"] },
      1: { main: [] },
    });
    startDuel(session);

    const xyz = session.state.cards.find((card) => card.code === "101305037");
    const summoned = session.state.cards.find((card) => card.code === "100");
    const material = session.state.cards.find((card) => card.code === "200");
    expect(xyz).toBeDefined();
    expect(summoned).toBeDefined();
    expect(material).toBeDefined();
    moveDuelCard(session.state, xyz!.uid, "monsterZone", 0);
    moveDuelCard(session.state, summoned!.uid, "deck", 0);
    moveDuelCard(session.state, material!.uid, "overlay", 0);
    xyz!.overlayUids.push(material!.uid);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c101305037.lua", "utf8"), "c101305037.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === xyz!.uid);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({
      location: "graveyard",
      reason: 0x80,
    });
    expect(session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids).toEqual([]);
  });

  it("loads Phantom Knights Malevolent Scythe and recovers a banished Phantom Knights card when destroyed", () => {
    const cards: DuelCardData[] = [
      { code: "101305037", name: "The Phantom Knights of Malevolent Scythe", kind: "extra", setcodes: [0xdb] },
      { code: "100", name: "Phantom Knights Banished", kind: "trap", setcodes: [0xdb] },
    ];
    const session = createDuel({ seed: 111, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"], extra: ["101305037"] },
      1: { main: [] },
    });
    startDuel(session);

    const xyz = session.state.cards.find((card) => card.code === "101305037");
    const recovered = session.state.cards.find((card) => card.code === "100");
    expect(xyz).toBeDefined();
    expect(recovered).toBeDefined();
    moveDuelCard(session.state, xyz!.uid, "monsterZone", 0);
    moveDuelCard(session.state, recovered!.uid, "banished", 0);
    recovered!.faceUp = true;

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c101305037.lua", "utf8"), "c101305037.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    destroyDuelCard(session.state, xyz!.uid, 0);
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === xyz!.uid);
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);

    expect(session.state.cards.find((card) => card.uid === recovered!.uid)).toMatchObject({
      location: "hand",
      controller: 0,
    });
  });

  it("loads Phantom Knights Umbrage Veil and summons itself as a trap monster", () => {
    const cards: DuelCardData[] = [
      { code: "101305073", name: "The Phantom Knights of Umbrage Veil", kind: "trap", setcodes: [0xdb] },
      { code: "100", name: "Phantom Knights Anchor", kind: "monster", setcodes: [0xdb] },
      { code: "200", name: "Opponent Attack", kind: "monster" },
    ];
    const session = createDuel({ seed: 113, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101305073", "100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const trap = session.state.cards.find((card) => card.code === "101305073");
    const anchor = session.state.cards.find((card) => card.code === "100");
    const opponent = session.state.cards.find((card) => card.code === "200");
    expect(trap).toBeDefined();
    expect(anchor).toBeDefined();
    expect(opponent).toBeDefined();
    moveDuelCard(session.state, trap!.uid, "spellTrapZone", 0);
    trap!.position = "faceDown";
    trap!.faceUp = false;
    moveDuelCard(session.state, anchor!.uid, "monsterZone", 0);
    moveDuelCard(session.state, opponent!.uid, "monsterZone", 1);
    opponent!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c101305073.lua", "utf8"), "c101305073.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === trap!.uid);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(session.state.cards.find((card) => card.uid === trap!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpDefense",
      faceUp: true,
    });
    expect(session.state.cards.find((card) => card.uid === opponent!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      position: "faceUpDefense",
    });
  });

  it("loads Phantom Knights Umbrage Veil and Xyz Summons from the GY", () => {
    const cards: DuelCardData[] = [
      { code: "101305073", name: "The Phantom Knights of Umbrage Veil", kind: "trap", setcodes: [0xdb] },
      { code: "980", name: "Dark Rank 3 Xyz", kind: "extra", typeFlags: 0x800001, level: 3, attribute: 0x20 },
      { code: "100", name: "Level 3 Material A", kind: "monster", level: 3 },
      { code: "200", name: "Level 3 Material B", kind: "monster", level: 3 },
    ];
    const session = createDuel({ seed: 114, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101305073", "100", "200"], extra: ["980"] },
      1: { main: [] },
    });
    startDuel(session);

    const trap = session.state.cards.find((card) => card.code === "101305073");
    const xyz = session.state.cards.find((card) => card.code === "980");
    const materials = session.state.cards.filter((card) => card.code === "100" || card.code === "200");
    expect(trap).toBeDefined();
    expect(xyz).toBeDefined();
    expect(materials).toHaveLength(2);
    moveDuelCard(session.state, trap!.uid, "graveyard", 0);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c101305073.lua", "utf8"), "c101305073.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === trap!.uid);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(session.state.cards.find((card) => card.uid === trap!.uid)).toMatchObject({
      location: "banished",
      reason: 0x80,
    });
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
      overlayUids: expect.arrayContaining(materials.map((card) => card.uid)),
    });
    for (const material of materials) expect(session.state.cards.find((card) => card.uid === material.uid)?.location).toBe("overlay");
  });

  it("loads Phantom Knights Rank-Up-Magic Requiem and ranks up a revived Xyz monster", () => {
    const cards: DuelCardData[] = [
      { code: "101305057", name: "The Phantom Knights' Rank-Up-Magic Requiem", kind: "spell", setcodes: [0x95] },
      { code: "100", name: "Phantom Knights Revive", kind: "monster", setcodes: [0xdb] },
      { code: "200", name: "Dark Rank 3 Xyz", kind: "extra", typeFlags: 0x800001, level: 3, attribute: 0x20, setcodes: [0xdb] },
      { code: "300", name: "Dark Rank 4 Xyz", kind: "extra", typeFlags: 0x800001, level: 4, attribute: 0x20, setcodes: [0xdb] },
      { code: "400", name: "Rank-Up Overlay", kind: "monster" },
    ];
    const session = createDuel({ seed: 115, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101305057", "100", "400"], extra: ["200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const spell = session.state.cards.find((card) => card.code === "101305057");
    const revived = session.state.cards.find((card) => card.code === "100");
    const rankThree = session.state.cards.find((card) => card.code === "200");
    const rankFour = session.state.cards.find((card) => card.code === "300");
    const overlay = session.state.cards.find((card) => card.code === "400");
    expect(spell).toBeDefined();
    expect(revived).toBeDefined();
    expect(rankThree).toBeDefined();
    expect(rankFour).toBeDefined();
    expect(overlay).toBeDefined();
    moveDuelCard(session.state, spell!.uid, "hand", 0);
    moveDuelCard(session.state, revived!.uid, "graveyard", 0);
    moveDuelCard(session.state, rankThree!.uid, "monsterZone", 0);
    moveDuelCard(session.state, overlay!.uid, "overlay", 0);
    rankThree!.overlayUids.push(overlay!.uid);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(fs.readFileSync("local-card-scripts/fallbacks/official/c101305057.lua", "utf8"), "c101305057.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === spell!.uid);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(session.state.cards.find((card) => card.uid === revived!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(session.state.cards.find((card) => card.uid === rankFour!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "special",
      overlayUids: expect.arrayContaining([rankThree!.uid]),
    });
    expect(session.state.cards.find((card) => card.uid === rankThree!.uid)).toMatchObject({
      location: "overlay",
    });
  });

  it("lets Lua scripts pay Ice Barrier discard costs", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Discard Cost", kind: "monster" },
      { code: "200", name: "Replacement Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 96, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const replacement = session.state.cards.find((card) => card.code === "200");
    expect(replacement).toBeDefined();
    moveDuelCard(session.state, replacement!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local discard=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local replacement=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local re=Effect.CreateEffect(replacement)
      re:SetType(EFFECT_TYPE_SINGLE)
      re:SetCode(EFFECT_ICEBARRIER_REPLACE)
      re:SetRange(LOCATION_GRAVE)
      re:SetCountLimit(1, CARD_REVEALER_ICEBARRIER)
      replacement:RegisterEffect(re)
      local e=Effect.CreateEffect(discard)
      local cost=aux.IceBarrierDiscardCost(nil,true,1,1)
      Debug.Message("ice constants " .. EFFECT_ICEBARRIER_REPLACE .. "/" .. CARD_REVEALER_ICEBARRIER)
      Debug.Message("ice hand check " .. tostring(cost(e,0,nil,0,0,nil,0,0,0)))
      Debug.Message("ice hand paid " .. cost(e,0,nil,0,0,nil,0,0,1) .. "/" .. tostring(discard:IsLocation(LOCATION_GRAVE)))
      local replacement_only=aux.IceBarrierDiscardCost(function(c) return false end,true,1,1)
      Debug.Message("ice replace check " .. tostring(replacement_only(e,0,nil,0,0,nil,0,0,0)) .. "/" .. tostring(re:CheckCountLimit(0)))
      Debug.Message("ice replace paid " .. replacement_only(e,0,nil,0,0,nil,0,0,1) .. "/" .. tostring(replacement:IsLocation(LOCATION_REMOVED)) .. "/" .. tostring(re:CheckCountLimit(0)))
      `,
      "ice-barrier-discard-cost.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("ice constants 18319762/18319762");
    expect(host.messages).toContain("ice hand check true");
    expect(host.messages).toContain("ice hand paid 1/true");
    expect(host.messages).toContain("ice replace check true/true");
    expect(host.messages).toContain("ice replace paid 1/true/false");
  });

  it("lets Lua scripts use self-banish cost aliases", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Banish Cost", kind: "monster" }];
    const session = createDuel({ seed: 83, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(c)
      Debug.Message("self banish check " .. tostring(Cost.SelfBanish(e,0,Group.CreateGroup(),0,0,nil,0,0,0)) .. "/" .. tostring(aux.bfgcost(e,0,Group.CreateGroup(),0,0,nil,0,0,0)))
      aux.bfgcost(e,0,Group.CreateGroup(),0,0,nil,0,0,1)
      Debug.Message("self banish moved " .. tostring(c:IsLocation(LOCATION_REMOVED)) .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "self-banish-cost.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("self banish check true/true");
    expect(host.messages).toContain("self banish moved true/100");
  });

  it("lets Lua scripts move cards to the deck top", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Top A", kind: "monster" },
      { code: "200", name: "Top B", kind: "monster" },
      { code: "300", name: "Top C", kind: "monster" },
      { code: "400", name: "Top D", kind: "monster" },
      { code: "900", name: "Top Hand", kind: "monster" },
    ];
    const session = createDuel({ seed: 74, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["900", "100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);
    const initialDeckOrder = getCards(session.state, 0, "deck").map((card) => card.code);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local top3 = Duel.GetDecktopGroup(0, 3)
      local third = top3:GetFirst()
      third = top3:GetNext()
      third = top3:GetNext()
      Debug.Message("top card " .. Duel.MoveToDeckTop(third, 0))
      Debug.Message("top card operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      local hand = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("top hand " .. Duel.MoveToDeckTop(hand, 0, REASON_EFFECT))
      Debug.Message("top hand operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("draw top " .. Duel.Draw(0, 1, REASON_EFFECT))
      Debug.Message("drawn card " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "move-to-deck-top.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("top card 1");
    expect(host.messages).toContain(`top card operated ${initialDeckOrder[2]}`);
    expect(host.messages).toContain("top hand 1");
    expect(host.messages).toContain("top hand operated 900");
    expect(host.messages).toContain("draw top 1");
    expect(host.messages).toContain("drawn card 900");
    expect(getCards(session.state, 0, "deck").map((card) => card.code)).toEqual([
      initialDeckOrder[2]!,
      initialDeckOrder[0]!,
      initialDeckOrder[1]!,
      initialDeckOrder[3]!,
    ]);
  });

  it("lets Lua scripts move cards to the deck bottom", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Bottom A", kind: "monster" },
      { code: "200", name: "Bottom B", kind: "monster" },
      { code: "300", name: "Bottom C", kind: "monster" },
      { code: "400", name: "Bottom D", kind: "monster" },
      { code: "500", name: "Bottom E", kind: "monster" },
      { code: "900", name: "Bottom Grave", kind: "monster" },
    ];
    const session = createDuel({ seed: 72, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "900"] },
      1: { main: [] },
    });
    startDuel(session);

    const graveCard = session.state.cards.find((card) => card.code === "900");
    expect(graveCard).toBeDefined();
    moveDuelCard(session.state, graveCard!.uid, "graveyard", 0);
    const initialDeckOrder = getCards(session.state, 0, "deck").map((card) => card.code);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("bottom number " .. Duel.MoveToDeckBottom(1, 0))
      Debug.Message("bottom number operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      local top2 = Duel.GetDecktopGroup(0, 2)
      Debug.Message("bottom group " .. Duel.MoveToDeckBottom(top2, 0))
      Debug.Message("bottom group operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      local grave = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("bottom grave " .. Duel.MoveToDeckBottom(grave, 0, REASON_EFFECT))
      Debug.Message("bottom grave operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "move-to-deck-bottom.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("bottom number 1");
    expect(host.messages).toContain(`bottom number operated ${initialDeckOrder[0]}`);
    expect(host.messages).toContain("bottom group 2");
    expect(host.messages).toContain(`bottom group operated 2/${initialDeckOrder[1]}`);
    expect(host.messages).toContain("bottom grave 1");
    expect(host.messages).toContain("bottom grave operated 900");
    expect(getCards(session.state, 0, "deck").map((card) => card.code)).toEqual([
      ...initialDeckOrder.slice(3),
      initialDeckOrder[0]!,
      initialDeckOrder[1]!,
      initialDeckOrder[2]!,
      "900",
    ]);
  });

  it("lets Lua scripts swap the deck and graveyard", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Swap Deck A", kind: "monster" },
      { code: "200", name: "Swap Deck B", kind: "monster" },
      { code: "300", name: "Swap Grave A", kind: "monster" },
      { code: "400", name: "Swap Grave B", kind: "monster" },
      { code: "500", name: "Swap Grave C", kind: "monster" },
    ];
    const session = createDuel({ seed: 177, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const code of ["300", "400", "500"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "graveyard", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("swap before " .. Duel.GetFieldGroupCount(0, LOCATION_DECK, 0) .. "/" .. Duel.GetFieldGroupCount(0, LOCATION_GRAVE, 0))
      Duel.SwapDeckAndGrave(0)
      Debug.Message("swap after " .. Duel.GetFieldGroupCount(0, LOCATION_DECK, 0) .. "/" .. Duel.GetFieldGroupCount(0, LOCATION_GRAVE, 0))
      Debug.Message("swap operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "swap-deck-and-grave.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("swap before 2/3");
    expect(host.messages).toContain("swap after 3/2");
    expect(host.messages).toContain("swap operated 5");
    expect(getCards(session.state, 0, "deck").map((card) => card.code).sort()).toEqual(["300", "400", "500"]);
    expect(getCards(session.state, 0, "graveyard").map((card) => card.code)).toEqual(["100", "200"]);
    expect(getCards(session.state, 0, "deck").every((card) => card.previousLocation === "graveyard")).toBe(true);
    expect(getCards(session.state, 0, "graveyard").every((card) => card.previousLocation === "deck")).toBe(true);
  });

  it("registers Lua equip spell procedures", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Procedure Target", kind: "monster" },
      { code: "501", name: "Procedure Equip", kind: "spell", typeFlags: 0x40002 },
    ];
    const session = createDuel({ seed: 40, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "501"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const equip = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "501");
    expect(target).toBeDefined();
    expect(equip).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c501={}
      function c501.initial_effect(c)
        aux.AddEquipProcedure(c,nil,aux.FilterBoolFunction(Card.IsCode,100),nil,nil,nil,function(e,tp)
          Debug.Message("equip procedure op " .. e:GetHandler():GetEquipTarget():GetCode())
        end)
      end
      `,
      "equip-procedure.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effectRecord) => effectRecord.sourceUid === equip!.uid)).toHaveLength(2);
    const actions = getDuelLegalActions(session, 0).filter((candidate) => candidate.type === "activateEffect" && candidate.uid === equip!.uid);
    expect(actions).toHaveLength(1);
    expect(applyResponse(session, actions[0]!).ok).toBe(true);
    while (session.state.chain.length > 0) {
      const player = session.state.waitingFor ?? session.state.turnPlayer;
      expect(applyResponse(session, { type: "passChain", player, label: "Pass" }).ok).toBe(true);
    }

    expect(host.messages).toContain("equip procedure op 100");
    expect(session.state.cards.find((card) => card.uid === equip!.uid)).toMatchObject({ location: "spellTrapZone", equippedToUid: target!.uid, faceUp: true });
  });

  it("lets Lua scripts equip cards to field monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Equip Target", kind: "monster" },
      { code: "500", name: "Equip Spell", kind: "spell", typeFlags: 0x40002 },
    ];
    const session = createDuel({ seed: 39, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local equip = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("equip result " .. tostring(Duel.Equip(0, equip, target)))
      Duel.EquipComplete()
      Debug.Message("equip operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("equip target " .. equip:GetEquipTarget():GetCode())
      Debug.Message("equip count " .. target:GetEquipCount() .. "/" .. target:GetEquipGroup():GetFirst():GetCode() .. "/" .. tostring(target:HasEquipCard()) .. "/" .. tostring(equip:HasEquipCard()))
      `,
      "equip-helper.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("equip result true");
    expect(host.messages).toContain("equip operated 500");
    expect(host.messages).toContain("equip target 100");
    expect(host.messages).toContain("equip count 1/500/true/false");
    expect(session.state.cards.find((card) => card.code === "500")).toMatchObject({ location: "spellTrapZone", equippedToUid: target!.uid, faceUp: true });
    expect(session.state.log.some((entry) => entry.action === "equip" && entry.detail === "Equipped to Equip Target")).toBe(true);
  });

  it("lets Lua scripts equip cards through effect limit registration helper", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Equip Limit Target", kind: "monster" },
      { code: "500", name: "Effect Equip Card", kind: "monster" },
    ];
    const session = createDuel({ seed: 152, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: [] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "100");
    expect(target).toBeTruthy();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local equip = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e = Effect.CreateEffect(target)
      local marker = Effect.CreateEffect(target)
      marker:SetType(EFFECT_TYPE_SINGLE)
      marker:SetCode(89785779 + EFFECT_EQUIP_LIMIT)
      target:RegisterEffect(marker)
      Debug.Message("effect equip result " .. tostring(target:EquipByEffectAndLimitRegister(e, 0, equip, 777001, true)))
      Debug.Message("effect equip target " .. equip:GetEquipTarget():GetCode())
      local limit = Effect.CreateEffect(target)
      limit:SetLabelObject(marker)
      local other = Effect.CreateEffect(target)
      Debug.Message("effect equip limit " .. tostring(Card.EquipByEffectLimit(limit,target)) .. "/" .. tostring(Card.EquipByEffectLimit(limit,equip)) .. "/" .. tostring(Card.EquipByEffectLimit(other,target)))
      Debug.Message("effect equip flag " .. equip:GetFlagEffect(777001))
      Debug.Message("effect equip operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "effect-equip-limit-register.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("effect equip result true");
    expect(host.messages).toContain("effect equip target 100");
    expect(host.messages).toContain("effect equip limit true/false/false");
    expect(host.messages).toContain("effect equip flag 1");
    expect(host.messages).toContain("effect equip operated 500");
    expect(session.state.cards.find((card) => card.code === "500")).toMatchObject({ location: "spellTrapZone", equippedToUid: target!.uid, faceUp: true });
  });

  it("lets Lua scripts register Eyes Restrict equip limits", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Eyes Restrict Source", kind: "monster" },
      { code: "500", name: "Eyes Restrict Equip", kind: "monster" },
    ];
    const session = createDuel({ seed: 158, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local equip = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local linked = Effect.CreateEffect(source)
      local e1,e2 = aux.AddEREquipLimit(source,nil,function(ec,c,tp) return ec:IsFaceup() end,aux.EquipAndLimitRegister,linked,EFFECT_FLAG_IGNORE_IMMUNE,RESET_EVENT+RESETS_STANDARD,1)
      Debug.Message("er metadata " .. e1:GetCode() .. "/" .. e1:GetProperty() .. "/" .. e2:GetCode() .. "/" .. e2:GetProperty() .. "/" .. tostring(linked:GetLabelObject()==e2))
      local reset,reset_count=e1:GetReset()
      Debug.Message("er reset " .. reset .. "/" .. reset_count .. "/" .. tostring(e1:GetValue()(source,source,0)))
      Debug.Message("er operation " .. tostring(e1:GetOperation()(equip,linked,0,source)))
      Debug.Message("er equip target " .. equip:GetEquipTarget():GetCode())
      Debug.Message("er equip limit " .. tostring(equip:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil))
      `,
      "eyes-restrict-equip-limit.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("er metadata 89785779/1152/89785855/128/true");
    expect(host.messages).toContain("er reset 33427456/1/true");
    expect(host.messages).toContain("er operation true");
    expect(host.messages).toContain("er equip target 100");
    expect(host.messages).toContain("er equip limit true");
    expect(session.state.cards.find((card) => card.code === "500")).toMatchObject({ location: "spellTrapZone", equippedToUid: source!.uid, faceUp: true });
  });

  it("lets Lua scripts register ZW equip limits", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "ZW Source", kind: "monster" },
      { code: "500", name: "ZW Equip", kind: "monster" },
    ];
    const session = createDuel({ seed: 159, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local equip = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local linked = Effect.CreateEffect(source)
      local e1,e2 = aux.AddZWEquipLimit(source,nil,function(ec,c,tp) return ec:IsFaceup() end,aux.EquipAndLimitRegister,linked,EFFECT_FLAG_IGNORE_IMMUNE,RESET_EVENT+RESETS_STANDARD,1)
      Debug.Message("zw metadata " .. e1:GetCode() .. "/" .. e1:GetProperty() .. "/" .. e2:GetCode() .. "/" .. e2:GetProperty() .. "/" .. tostring(linked:GetLabelObject()==e2))
      local reset,reset_count=e1:GetReset()
      Debug.Message("zw reset " .. reset .. "/" .. reset_count .. "/" .. tostring(e1:GetValue()(source,source,0)))
      Debug.Message("zw operation " .. tostring(e1:GetOperation()(equip,linked,0,source)))
      Debug.Message("zw equip target " .. equip:GetEquipTarget():GetCode())
      Debug.Message("zw equip limit " .. tostring(equip:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil))
      `,
      "zw-equip-limit.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("zw metadata 75402014/1152/75402090/128/true");
    expect(host.messages).toContain("zw reset 33427456/1/true");
    expect(host.messages).toContain("zw operation true");
    expect(host.messages).toContain("zw equip target 100");
    expect(host.messages).toContain("zw equip limit true");
    expect(session.state.cards.find((card) => card.code === "500")).toMatchObject({ location: "spellTrapZone", equippedToUid: source!.uid, faceUp: true });
  });

  it("lets Lua scripts register Neos return effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Neos Fusion", kind: "monster" },
      { code: "14088859", name: "Contact Out", kind: "monster" },
    ];
    const session = createDuel({ seed: 160, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "14088859"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const substitute = session.state.cards.find((card) => card.code === "14088859");
    expect(source).toBeTruthy();
    expect(substitute).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).faceUp = true;
    moveDuelCard(session.state, substitute!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local marker = Effect.CreateEffect(c)
      local e1,e2 = aux.EnableNeosReturn(c,CATEGORY_DESTROY,function(e,tp,eg,ep,ev,re,r,rp,chk) Debug.Message("neos extra info " .. chk) end,function(e,tp) Debug.Message("neos extra op " .. tp) end,marker)
      Debug.Message("neos metadata " .. e1:GetCategory() .. "/" .. e1:GetType() .. "/" .. e2:GetType() .. "/" .. e1:GetCode() .. "/" .. e1:GetRange() .. "/" .. e1:GetCountLimit())
      Debug.Message("neos labels " .. tostring(e1:GetLabelObject()==marker) .. "/" .. tostring(e2:GetLabelObject()==marker))
      Debug.Message("neos conditions " .. tostring(e1:GetCondition()(e1,0,Group.CreateGroup(),0,0,nil,0,0)) .. "/" .. tostring(e2:GetCondition()(e2,0,Group.CreateGroup(),0,0,nil,0,0)))
      Debug.Message("neos target " .. tostring(e1:GetTarget()(e1,0,Group.CreateGroup(),0,0,nil,0,0,0)))
      e1:GetTarget()(e1,0,Group.CreateGroup(),0,0,nil,0,0,1)
      local ok,cat,g,count,p,param=Duel.GetOperationInfo(0,CATEGORY_TODECK)
      Debug.Message("neos op info " .. tostring(ok) .. "/" .. cat .. "/" .. g:GetCount() .. "/" .. count)
      e1:GetOperation()(e1,0,Group.CreateGroup(),0,0,nil,0,0)
      Debug.Message("neos locations " .. c:GetLocation() .. "/" .. Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,14088859),0,LOCATION_REMOVED,0,nil):GetCode())
      `,
      "neos-return.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("neos metadata 17/514/130/4608/4/1");
    expect(host.messages).toContain("neos labels true/true");
    expect(host.messages).toContain("neos conditions true/nil");
    expect(host.messages).toContain("neos target true");
    expect(host.messages).toContain("neos extra info 1");
    expect(host.messages).toContain("neos op info true/16/1/1");
    expect(host.messages).toContain("neos locations 4/14088859");
    expect(session.state.cards.find((card) => card.code === "14088859")).toMatchObject({ location: "banished" });
  });

  it("lets Lua scripts install Attraction equip procedures and conditions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attraction Trap", kind: "trap", typeFlags: 0x4, setcodes: [0x15f] },
      { code: "200", name: "Amazement Monster", kind: "monster", typeFlags: 0x21, setcodes: [0x15e] },
      { code: "300", name: "Opponent Monster", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 157, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300"] },
    });
    startDuel(session);
    const trap = session.state.cards.find((card) => card.code === "100");
    const ownMonster = session.state.cards.find((card) => card.code === "200");
    const opponentMonster = session.state.cards.find((card) => card.code === "300");
    expect(trap).toBeDefined();
    expect(ownMonster).toBeDefined();
    expect(opponentMonster).toBeDefined();
    moveDuelCard(session.state, trap!.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, ownMonster!.uid, "monsterZone", 0).faceUp = true;
    moveDuelCard(session.state, opponentMonster!.uid, "monsterZone", 1).faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local trap = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      local own = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opp = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      local e = aux.AddAttractionEquipProc(trap)
      Debug.Message("attraction registered " .. tostring(e:IsHasType(EFFECT_TYPE_ACTIVATE)) .. "/" .. e:GetCode() .. "/" .. tostring(e:GetCost()~=nil) .. "/" .. tostring(e:GetTarget()~=nil) .. "/" .. tostring(e:GetOperation()~=nil))
      Debug.Message("attraction target check " .. tostring(e:GetTarget()(e,0,nil,0,0,nil,0,0,0)))
      Debug.Message("attraction filters " .. tostring(AA.eqtgfilter(own,0)) .. "/" .. tostring(AA.eqtgfilter(opp,0)))
      Duel.Equip(0,trap,own)
      local cond_self = aux.AttractionEquipCon(true)
      local cond_opp = aux.AttractionEquipCon(false)
      local ce = Effect.CreateEffect(trap)
      Debug.Message("attraction condition self " .. tostring(cond_self(ce)) .. "/" .. tostring(cond_opp(ce)))
      Duel.Equip(0,trap,opp)
      Debug.Message("attraction condition opp " .. tostring(cond_self(ce)) .. "/" .. tostring(cond_opp(ce)))
      `,
      "attraction-equip-proc.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("attraction registered true/1002/true/true/true");
    expect(host.messages).toContain("attraction target check true");
    expect(host.messages).toContain("attraction filters true/true");
    expect(host.messages).toContain("attraction condition self true/false");
    expect(host.messages).toContain("attraction condition opp false/true");
  });

  it("lets Lua scripts install Amazement quick equip effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attraction Trap", kind: "trap", typeFlags: 0x4, setcodes: [0x15f] },
      { code: "200", name: "Amazement Monster", kind: "monster", typeFlags: 0x21, setcodes: [0x15e] },
      { code: "300", name: "Opponent Monster", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 158, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300"] },
    });
    startDuel(session);
    const trap = session.state.cards.find((card) => card.code === "100");
    const ownMonster = session.state.cards.find((card) => card.code === "200");
    const opponentMonster = session.state.cards.find((card) => card.code === "300");
    expect(trap).toBeDefined();
    expect(ownMonster).toBeDefined();
    expect(opponentMonster).toBeDefined();
    moveDuelCard(session.state, trap!.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, ownMonster!.uid, "monsterZone", 0).faceUp = true;
    moveDuelCard(session.state, opponentMonster!.uid, "monsterZone", 1).faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local trap = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      local own = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opp = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      Duel.Equip(0,trap,own)
      local e = aux.AddAmazementQuickEquipEffect(own,200)
      Debug.Message("amazement quick metadata " .. tostring(e:IsHasType(EFFECT_TYPE_QUICK_O)) .. "/" .. e:GetCode() .. "/" .. e:GetDescription() .. "/" .. tostring(e:GetTarget()~=nil) .. "/" .. tostring(e:GetOperation()~=nil))
      Debug.Message("amazement quick filters " .. tostring(AA.eqsfilter(trap,0)) .. "/" .. tostring(AA.eqmfilter(opp,0)))
      Debug.Message("amazement quick target " .. tostring(e:GetTarget()(e,0,nil,0,0,nil,0,0,0)))
      `,
      "amazement-quick-equip.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("amazement quick metadata true/1002/3201/true/true");
    expect(host.messages).toContain("amazement quick filters true/true");
    expect(host.messages).toContain("amazement quick target true");
  });

  it("lets Lua scripts temporarily banish cards through aux.RemoveUntil", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Temporary Banish A", kind: "monster" },
      { code: "200", name: "Temporary Banish B", kind: "monster" },
    ];
    const session = createDuel({ seed: 153, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local g = Duel.GetMatchingGroup(aux.TRUE, 0, LOCATION_MZONE, 0, nil)
      Debug.Message("remove until result " .. tostring(aux.RemoveUntil(g, POS_FACEUP, REASON_EFFECT, PHASE_END, 777002, nil, 0, aux.DefaultFieldReturnOp)))
      Debug.Message("remove until operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("remove until banished " .. Duel.GetMatchingGroupCount(aux.TRUE, 0, LOCATION_REMOVED, 0, nil))
      Debug.Message("remove until empty " .. tostring(aux.RemoveUntil(Group.CreateGroup(), POS_FACEUP, REASON_EFFECT, PHASE_END, 777002, nil, 0, aux.DefaultFieldReturnOp)))
      `,
      "aux-remove-until.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("remove until result true");
    expect(host.messages).toContain("remove until operated 2");
    expect(host.messages).toContain("remove until banished 2");
    expect(host.messages).toContain("remove until empty false");
  });

  it("lets Lua scripts check steal-equip control requirements", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Steal Source", kind: "monster" },
      { code: "200", name: "Opponent Faceup", kind: "monster" },
      { code: "300", name: "Opponent Facedown", kind: "monster" },
      { code: "400", name: "Own Faceup", kind: "monster" },
    ];
    const session = createDuel({ seed: 40, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "400"] },
      1: { main: ["200", "300"] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const own = session.state.cards.find((card) => card.controller === 0 && card.code === "400");
    const opponentFaceup = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    const opponentFacedown = session.state.cards.find((card) => card.controller === 1 && card.code === "300");
    for (const card of [source, own, opponentFaceup, opponentFacedown]) expect(card).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, own!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponentFaceup!.uid, "monsterZone", 1).position = "faceUpAttack";
    const facedown = moveDuelCard(session.state, opponentFacedown!.uid, "monsterZone", 1);
    facedown.position = "faceDownDefense";
    facedown.faceUp = false;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source=Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local own=Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      local faceup=Duel.GetFieldCard(1, LOCATION_MZONE, 0)
      local facedown=Duel.GetFieldCard(1, LOCATION_MZONE, 1)
      local e=Effect.CreateEffect(source)
      Debug.Message("steal checks " .. tostring(aux.CheckStealEquip(faceup,e,0)) .. "/" .. tostring(aux.CheckStealEquip(own,e,0)) .. "/" .. tostring(aux.CheckStealEquip(facedown,e,0)))
      Duel.MoveToField(source,0,0,LOCATION_SZONE,POS_FACEUP_ATTACK,true)
      Debug.Message("steal szone " .. tostring(aux.CheckStealEquip(faceup,e,0)))
      `,
      "check-steal-equip.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("steal checks true/false/false");
    expect(host.messages).toContain("steal szone true");
  });

  it("lets Lua scripts hide Spell/Trap cards as face-down monster-zone decoys", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Decoy Spell A", kind: "spell", typeFlags: 0x2 },
      { code: "200", name: "Decoy Trap B", kind: "trap", typeFlags: 0x4 },
    ];
    const session = createDuel({ seed: 41, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local g=Duel.GetMatchingGroup(aux.TRUE,0,LOCATION_HAND,0,nil)
      local hidden=Group.CreateGroup()
      for tc in aux.Next(g) do
        if Duel.MoveToField(tc,0,0,LOCATION_MZONE,POS_FACEDOWN_DEFENSE,true)>0 then
          hidden:AddCard(tc)
        end
      end
      Duel.ShuffleSetCard(hidden)
      local first=Duel.GetFieldCard(0,LOCATION_MZONE,0)
      local second=Duel.GetFieldCard(0,LOCATION_MZONE,1)
      Debug.Message("hidden decoys " .. Duel.GetOperatedGroup():GetCount() .. "/" .. first:GetLocation() .. "/" .. tostring(first:IsFacedown()) .. "/" .. tostring(first:IsSpellTrapCard()))
      Debug.Message("hidden second " .. second:GetLocation() .. "/" .. tostring(second:IsFacedown()) .. "/" .. tostring(second:IsSpellTrapCard()))
      `,
      "spell-trap-monster-decoys.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("hidden decoys 2/4/true/true");
    expect(host.messages).toContain("hidden second 4/true/true");
    expect(session.state.cards.filter((card) => card.location === "monsterZone" && !card.faceUp).map((card) => card.code).sort()).toEqual(["100", "200"]);
  });

  it("lets Lua scripts move cards to hand, deck, and extra deck", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Recoverable Monster", kind: "monster" },
      { code: "300", name: "Illegal Extra Return", kind: "monster" },
      { code: "301", name: "Pendulum Extra Return", kind: "monster", typeFlags: 0x1000001 },
      { code: "900", name: "Extra Return", kind: "extra" },
      { code: "901", name: "Extra Alias Return", kind: "extra" },
      { code: "902", name: "Generic Extra Return", kind: "extra" },
    ];
    const session = createDuel({ seed: 9, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "301"], extra: ["900", "901", "902"] },
      1: { main: ["100", "300"] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && (candidate.code === "100" || candidate.code === "300" || candidate.code === "301" || candidate.code === "900" || candidate.code === "901" || candidate.code === "902"))) {
      moveDuelCard(session.state, card.uid, "graveyard", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local recover = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("to hand " .. Duel.SendtoHand(recover, 0, REASON_EFFECT))
      Debug.Message("operated hand " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      local hand = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("to deck " .. Duel.SendtoDeck(hand, 0, 0, REASON_EFFECT))
      Debug.Message("operated deck " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      local extra = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("to extra " .. Duel.SendtoExtraP(extra, 0, REASON_EFFECT))
      Debug.Message("operated extra " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("extra faceup " .. tostring(Duel.GetOperatedGroup():GetFirst():IsFaceup()))
      local extra_alias = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 901), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("to extra alias " .. Duel.SendtoExtra(extra_alias, 0, REASON_EFFECT))
      Debug.Message("operated extra alias " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      local generic_extra = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 902), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("generic to extra " .. Duel.Sendto(generic_extra, LOCATION_EXTRA, REASON_EFFECT, POS_FACEDOWN_DEFENSE))
      Debug.Message("operated generic extra " .. Duel.GetOperatedGroup():GetFirst():GetCode() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetLocation() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetPosition())
      local pendulum = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("pendulum able extra " .. tostring(pendulum:GetFirst():IsAbleToExtra()))
      Debug.Message("to pendulum extra " .. Duel.SendtoExtraP(pendulum, 0, REASON_EFFECT))
      Debug.Message("pendulum extra faceup " .. tostring(Duel.GetOperatedGroup():GetFirst():IsFaceup()))
      local illegal = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("illegal extra " .. Duel.SendtoExtraP(illegal, 0, REASON_EFFECT))
      Debug.Message("operated illegal " .. Duel.GetOperatedGroup():GetCount())
      `,
      "movement-helpers.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("to hand 1");
    expect(host.messages).toContain("operated hand 100");
    expect(host.messages).toContain("to deck 1");
    expect(host.messages).toContain("operated deck 100");
    expect(host.messages).toContain("to extra 1");
    expect(host.messages).toContain("operated extra 900");
    expect(host.messages).toContain("extra faceup false");
    expect(host.messages).toContain("to extra alias 1");
    expect(host.messages).toContain("operated extra alias 901");
    expect(host.messages).toContain("generic to extra 1");
    expect(host.messages).toContain("operated generic extra 902/64/8");
    expect(host.messages).toContain("pendulum able extra true");
    expect(host.messages).toContain("to pendulum extra 1");
    expect(host.messages).toContain("pendulum extra faceup true");
    expect(host.messages).toContain("illegal extra 0");
    expect(host.messages).toContain("operated illegal 0");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "100")?.location).toBe("deck");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "900")?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "902")).toMatchObject({ location: "extraDeck", faceUp: false, position: "faceDownDefense" });
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "301")).toMatchObject({ location: "extraDeck", faceUp: true });
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "300")?.location).toBe("graveyard");
  });

  it("lets Lua scripts move cards to hand or fallback elsewhere", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "To Hand First", kind: "monster" },
      { code: "200", name: "Fallback Only", kind: "monster" },
      { code: "300", name: "No Legal Move", kind: "monster" },
    ];
    const session = createDuel({ seed: 161, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.owner === 0)) {
      moveDuelCard(session.state, card.uid, "graveyard", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local first = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local fallback = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local blocked = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local cannot_hand=Effect.CreateEffect(fallback)
      cannot_hand:SetType(EFFECT_TYPE_SINGLE)
      cannot_hand:SetCode(EFFECT_CANNOT_TO_HAND)
      fallback:RegisterEffect(cannot_hand)
      local blocked_cannot_hand=Effect.CreateEffect(blocked)
      blocked_cannot_hand:SetType(EFFECT_TYPE_SINGLE)
      blocked_cannot_hand:SetCode(EFFECT_CANNOT_TO_HAND)
      blocked:RegisterEffect(blocked_cannot_hand)
      Debug.Message("thoe hand " .. aux.ToHandOrElse(first,0) .. "/" .. first:GetLocation())
      Debug.Message("thoe fallback " .. aux.ToHandOrElse(fallback,0,function(c) return c:IsAbleToDeck() end,function(c) return Duel.SendtoDeck(c,0,0,REASON_EFFECT) end,574) .. "/" .. fallback:GetLocation())
      Debug.Message("thoe none " .. aux.ToHandOrElse(blocked,0,function(c) return false end,function(c) return Duel.SendtoDeck(c,0,0,REASON_EFFECT) end,574) .. "/" .. blocked:GetLocation())
      `,
      "to-hand-or-else.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("thoe hand 1/2");
    expect(host.messages).toContain("thoe fallback 1/1");
    expect(host.messages).toContain("thoe none 0/16");
  });

  it("lets Lua scripts take control of field cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Self A", kind: "monster" },
      { code: "200", name: "Self B", kind: "monster" },
      { code: "300", name: "Self C", kind: "monster" },
      { code: "600", name: "Taken A", kind: "monster" },
      { code: "700", name: "Taken B", kind: "monster" },
      { code: "800", name: "Blocked", kind: "monster" },
    ];
    const session = createDuel({ seed: 41, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["600", "700", "800"] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", card.controller);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local taken = Duel.SelectMatchingCard(0, function(c) return c:IsCode(600) or c:IsCode(700) end, 0, 0, LOCATION_MZONE, 1, 2, nil)
      Debug.Message("take group " .. Duel.GetControl(taken, 0, 0, 0, LOCATION_MZONE))
      Debug.Message("take operated " .. Duel.GetOperatedGroup():GetCount())
      local first = Duel.GetOperatedGroup():GetFirst()
      Debug.Message("take first controller " .. first:GetControler())
      local blocked = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 800), 0, 0, LOCATION_MZONE, 1, 1, nil)
      Debug.Message("take blocked " .. Duel.GetControl(blocked, 0, 0, 0, LOCATION_MZONE))
      Debug.Message("take blocked operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("self mzone count " .. Duel.GetFieldGroupCount(0, LOCATION_MZONE, 0))
      Debug.Message("opponent mzone count " .. Duel.GetFieldGroupCount(1, LOCATION_MZONE, 0))
      Debug.Message("self usable mzone " .. Duel.GetUsableMZoneCount(0))
      Debug.Message("self usable excluding taken " .. Duel.GetUsableMZoneCount(0, taken))
      Debug.Message("opponent usable mzone " .. Duel.GetUsableMZoneCount(1))
      `,
      "get-control.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("take group 2");
    expect(host.messages).toContain("take operated 2");
    expect(host.messages).toContain("take first controller 0");
    expect(host.messages).toContain("take blocked 0");
    expect(host.messages).toContain("take blocked operated 0");
    expect(host.messages).toContain("self mzone count 5");
    expect(host.messages).toContain("opponent mzone count 1");
    expect(host.messages).toContain("self usable mzone 0");
    expect(host.messages).toContain("self usable excluding taken 2");
    expect(host.messages).toContain("opponent usable mzone 4");
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "monsterZone")).toHaveLength(5);
    expect(session.state.cards.find((card) => card.code === "800")).toMatchObject({ controller: 1, location: "monsterZone", sequence: 0 });
  });

  it("lets Lua scripts swap control of field cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Swap Self", kind: "monster" },
      { code: "101", name: "Swap Self Filler A", kind: "monster" },
      { code: "102", name: "Swap Self Filler B", kind: "monster" },
      { code: "103", name: "Swap Self Filler C", kind: "monster" },
      { code: "104", name: "Swap Self Filler D", kind: "monster" },
      { code: "500", name: "Self Spell A", kind: "spell" },
      { code: "501", name: "Self Spell B", kind: "spell" },
      { code: "502", name: "Self Spell C", kind: "spell" },
      { code: "503", name: "Self Spell D", kind: "spell" },
      { code: "504", name: "Self Spell E", kind: "spell" },
      { code: "600", name: "Swap Opponent", kind: "monster" },
      { code: "601", name: "Swap Opponent Filler A", kind: "monster" },
      { code: "602", name: "Swap Opponent Filler B", kind: "monster" },
      { code: "603", name: "Swap Opponent Filler C", kind: "monster" },
      { code: "604", name: "Swap Opponent Filler D", kind: "monster" },
      { code: "900", name: "Opponent Spell", kind: "spell" },
    ];
    const session = createDuel({ seed: 63, startingHandSize: 10, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "101", "102", "103", "104", "500", "501", "502", "503", "504"] },
      1: { main: ["600", "601", "602", "603", "604", "900"] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.kind === "monster")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.kind === "spell")) {
      moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
    }
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 1 && candidate.location === "hand" && candidate.kind === "monster")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 1);
    }
    const opponentSpell = session.state.cards.find((card) => card.controller === 1 && card.code === "900");
    moveDuelCard(session.state, opponentSpell!.uid, "spellTrapZone", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local self_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opponent_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      Debug.Message("swap monsters " .. tostring(Duel.SwapControl(self_monster, opponent_monster)))
      Debug.Message("swap operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("swap controllers " .. self_monster:GetControler() .. "/" .. opponent_monster:GetControler())
      local opponent_spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, 0, LOCATION_SZONE, 1, 1, nil):GetFirst()
      Debug.Message("swap blocked " .. tostring(Duel.SwapControl(opponent_monster, opponent_spell)))
      Debug.Message("swap blocked operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "swap-control.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("swap monsters true");
    expect(host.messages).toContain("swap operated 2");
    expect(host.messages).toContain("swap controllers 1/0");
    expect(host.messages).toContain("swap blocked false");
    expect(host.messages).toContain("swap blocked operated 0");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ controller: 1, location: "monsterZone" });
    expect(session.state.cards.find((card) => card.code === "600")).toMatchObject({ controller: 0, location: "monsterZone" });
    expect(session.state.cards.find((card) => card.code === "900")).toMatchObject({ controller: 1, location: "spellTrapZone" });
  });

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
    const activation = applyResponse(session, action!);

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
    expect(host.messages).toContain("extra can special false");
    expect(host.messages).toContain("pendulum special 1");
    expect(host.messages).toContain("can pendulum after summon false");
    expect(host.messages).toContain("pendulum operated 301");
    expect(host.messages).toContain("extra special 0");
    expect(host.messages).toContain("extra operated 0");
    expect(session.state.cards.find((card) => card.uid === pendulum!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "special" });
    expect(session.state.cards.find((card) => card.uid === extra!.uid)).toMatchObject({ location: "extraDeck", faceUp: false });
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
      `,
      "pendulum-summon.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("pendulum before true");
    expect(host.messages).toContain("pendulum summon 2");
    expect(host.messages).toContain("pendulum operated 2");
    expect(host.messages).toContain("pendulum field 2");
    expect(host.messages).toContain("pendulum after false");
    expect(session.state.cards.find((card) => card.uid === handPendulum!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "special" });
    expect(session.state.cards.find((card) => card.uid === extraPendulum!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "special" });
    expect(session.state.cards.find((card) => card.uid === outOfScale!.uid)).toMatchObject({ location: "hand" });
  });
});
