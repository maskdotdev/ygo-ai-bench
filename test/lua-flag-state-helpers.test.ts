import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, restoreDuel, sendDuelCardToGraveyard, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua flag state helpers", () => {
  it("lets Lua scripts query duel type flags and enable unofficial procedures", () => {
    const session = createDuel({ seed: 99, startingHandSize: 0, duelTypeFlags: 0x2000 + 0x4000 + 0x8000 + 0x1000000000 });
    loadDecks(session, {
      0: { main: [] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("duel type default " .. tostring(Duel.IsDuelType(DUEL_EMZONE)) .. "/" .. tostring(Duel.IsDuelType(DUEL_SEPARATE_PZONE)))
      Debug.Message("duel type high " .. tostring(Duel.IsDuelType(DUEL_NORMAL_SUMMON_FACEUP_DEF)))
      Debug.Message("master rule " .. Duel.GetMasterRule())
      Debug.Message("deck master default " .. tostring(Duel.IsDeckMaster(0, 153000001)) .. "/" .. tostring(Duel.GetDeckMaster(0)==nil))
      Debug.Message("deck master flag constant " .. FLAG_DECK_MASTER)
      Debug.Message("additional tribute default " .. tostring(Duel.IsPlayerCanAdditionalTributeSummon(0)))
      Duel.RegisterFlagEffect(0, 52112003, RESET_EVENT, 0, 1)
      Debug.Message("additional tribute flagged " .. tostring(Duel.IsPlayerCanAdditionalTributeSummon(0)))
      Duel.ResetFlagEffect(0, 52112003)
      Debug.Message("additional tribute reset " .. tostring(Duel.IsPlayerCanAdditionalTributeSummon(0)))
      Duel.EnableUnofficialProc()
      Duel.EnableGlobalFlag(GLOBALFLAG_DETACH_EVENT)
      Duel.EnableGlobalFlag(GLOBALFLAG_SELF_TOGRAVE)
      Debug.Message("unofficial enabled")
      `,
      "duel-type.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("duel type default true/false");
    expect(host.messages).toContain("duel type high true");
    expect(host.messages).toContain("master rule 5");
    expect(host.messages).toContain("deck master default false/true");
    expect(host.messages).toContain("deck master flag constant 153000000");
    expect(host.messages).toContain("additional tribute default true");
    expect(host.messages).toContain("additional tribute flagged false");
    expect(host.messages).toContain("additional tribute reset true");
    expect(host.messages).toContain("unofficial enabled");
    expect(session.state.unofficialProcEnabled).toBe(true);
    expect(session.state.globalFlags).toBe(0x10 | 0x100);
    expect(restoreDuel(serializeDuel(session)).state.unofficialProcEnabled).toBe(true);
    expect(restoreDuel(serializeDuel(session)).state.globalFlags).toBe(0x10 | 0x100);
  });

  it("lets Lua effects register, read, and reset duel and card flags", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Flag Source", kind: "monster" }];
    const session = createDuel({ seed: 22, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,c)
          Debug.Message("duel flag register " .. Duel.RegisterFlagEffect(0, 901, RESET_EVENT, 0, 3))
          Debug.Message("card flag register " .. c:RegisterFlagEffect(902, RESET_EVENT, 0, 4))
          Duel.RegisterFlagEffect(0, 903, RESET_EVENT, EFFECT_FLAG_REPEAT, 1)
          Duel.RegisterFlagEffect(0, 903, RESET_EVENT, EFFECT_FLAG_REPEAT, 1)
          c:RegisterFlagEffect(904, RESET_EVENT, EFFECT_FLAG_REPEAT, 1)
          c:RegisterFlagEffect(904, RESET_EVENT, EFFECT_FLAG_REPEAT, 1)
          Debug.Message("duel has flag " .. tostring(Duel.HasFlagEffect(0, 901)) .. "/" .. tostring(Duel.HasFlagEffect(0, 901, 2)) .. "/" .. tostring(Duel.HasFlagEffect(0, 903, 2)))
          Debug.Message("card has flag " .. tostring(c:HasFlagEffect(902)) .. "/" .. tostring(c:HasFlagEffect(902, 2)) .. "/" .. tostring(c:HasFlagEffect(904, 2)))
          return true
        end)
        e:SetOperation(function(e,c)
          Debug.Message("duel flag count " .. Duel.GetFlagEffect(0, 901))
          Debug.Message("card flag count " .. c:GetFlagEffect(902))
          Debug.Message("duel flag reset " .. Duel.ResetFlagEffect(0, 901))
          Debug.Message("card flag reset " .. c:ResetFlagEffect(902))
          Duel.ResetFlagEffect(0, 903)
          c:ResetFlagEffect(904)
          Debug.Message("duel flag after " .. Duel.GetFlagEffect(0, 901))
          Debug.Message("card flag after " .. c:GetFlagEffect(902))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-effects.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    passCurrentChain(session);
    passCurrentChain(session);
    expect(host.messages).toContain("duel flag register 1");
    expect(host.messages).toContain("card flag register 1");
    expect(host.messages).toContain("duel has flag true/false/true");
    expect(host.messages).toContain("card has flag true/false/true");
    expect(host.messages).toContain("duel flag count 1");
    expect(host.messages).toContain("card flag count 1");
    expect(host.messages).toContain("duel flag reset 1");
    expect(host.messages).toContain("card flag reset 1");
    expect(host.messages).toContain("duel flag after 0");
    expect(host.messages).toContain("card flag after 0");
    expect(session.state.flagEffects).toHaveLength(0);
  });

  it("keeps flag helpers from mutating ended duels", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Ended Flag Source", kind: "monster" }];
    const session = createDuel({ seed: 201, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "100");
    expect(target).toBeDefined();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_HAND,0,1,1,nil):GetFirst()
      Duel.RegisterFlagEffect(0,951,RESET_EVENT,0,1,51)
      c:RegisterFlagEffect(952,RESET_EVENT,0,1,61)
      Duel.Win(0,WIN_REASON_EXODIA)
      Debug.Message("duel register ended " .. Duel.RegisterFlagEffect(0,951,RESET_EVENT,0,1,52))
      Debug.Message("card register ended " .. c:RegisterFlagEffect(952,RESET_EVENT,0,1,62))
      Debug.Message("duel set ended " .. Duel.SetFlagEffectLabel(0,951,53))
      Debug.Message("card set ended " .. c:SetFlagEffectLabel(952,63))
      Debug.Message("duel reset ended " .. Duel.ResetFlagEffect(0,951))
      Debug.Message("card reset ended " .. c:ResetFlagEffect(952))
      Duel.EnableUnofficialProc()
      Duel.EnableGlobalFlag(GLOBALFLAG_DETACH_EVENT)
      c:SetUniqueOnField(1,1,100,LOCATION_MZONE)
      c:MoveToDeckMasterZone(0)
      Debug.Message("duel flag kept " .. Duel.GetFlagEffect(0,951) .. "/" .. Duel.GetFlagEffectLabel(0,951))
      Debug.Message("card flag kept " .. c:GetFlagEffect(952) .. "/" .. c:GetFlagEffectLabel(952))
      `,
      "ended-flag-noop.lua",
    );
    expect(result.ok, result.error).toBe(true);

    expect(host.messages).toEqual([
      "duel register ended 0",
      "card register ended 0",
      "duel set ended 0",
      "card set ended 0",
      "duel reset ended 0",
      "card reset ended 0",
      "duel flag kept 1/51",
      "card flag kept 1/61",
    ]);
    expect(session.state.status).toBe("ended");
    expect(session.state.globalFlags).toBe(0);
    expect(session.state.unofficialProcEnabled).toBe(false);
    expect(target!.location).toBe("hand");
    expect(target!.uniqueOnField).toBeUndefined();
    expect(session.state.flagEffects).toEqual([
      expect.objectContaining({ ownerType: "player", ownerId: "0", code: 951, value: 51 }),
      expect.objectContaining({ ownerType: "card", ownerId: target!.uid, code: 952, value: 61 }),
    ]);
  });

  it("lets Lua scripts identify deck master flagged cards", () => {
    const cards: DuelCardData[] = [{ code: "153000001", name: "Deck Master Probe", kind: "monster" }];
    const session = createDuel({ seed: 178, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["153000001"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("deck master card default " .. tostring(c:IsDeckMaster()))
      c:RegisterFlagEffect(FLAG_DECK_MASTER, RESET_EVENT, 0, 1)
      Debug.Message("deck master card flagged " .. tostring(c:IsDeckMaster()) .. "/" .. c:GetFlagEffect(FLAG_DECK_MASTER))
      c:ResetFlagEffect(FLAG_DECK_MASTER)
      Debug.Message("deck master card reset " .. tostring(c:IsDeckMaster()))
      `,
      "deck-master-card-flag.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("deck master card default false");
    expect(host.messages).toContain("deck master card flagged true/1");
    expect(host.messages).toContain("deck master card reset false");
  });

  it("lets Lua scripts record unique-on-field metadata", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Unique Probe", kind: "monster" }];
    const session = createDuel({ seed: 179, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      c:SetUniqueOnField(1,0,100,LOCATION_MZONE)
      Debug.Message("unique registered " .. c:GetCode())
      `,
      "unique-on-field.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("unique registered 100");
    expect(session.state.cards.find((card) => card.code === "100")?.uniqueOnField).toEqual({
      self: true,
      opponent: false,
      code: 100,
      locationMask: 0x4,
    });
  });

  it("lets Lua scripts query, summon, and clear deck master flagged cards", () => {
    const cards: DuelCardData[] = [{ code: "153000001", name: "Deck Master Probe", kind: "monster", attack: 1200, defense: 800 }];
    const session = createDuel({ seed: 167, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["153000001"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.GetFieldGroup(0,LOCATION_HAND,0):GetFirst()
      c:RegisterFlagEffect(FLAG_DECK_MASTER, RESET_EVENT, 0, 1)
      Debug.Message("deck master flagged " .. tostring(Duel.IsDeckMaster(0,153000001)) .. "/" .. Duel.GetDeckMaster(0):GetCode() .. "/" .. tostring(c:IsDeckMaster()))
      Debug.Message("deck master summon " .. Duel.SummonDeckMaster(0) .. "/" .. c:GetLocation() .. "/" .. tostring(c:IsFaceup()) .. "/" .. Duel.GetDeckMaster(0):GetCode())
      Debug.Message("deck master clear " .. Duel.ClearDeckMasterZone(0) .. "/" .. tostring(Duel.GetDeckMaster(0)==nil) .. "/" .. tostring(c:IsDeckMaster()))
      `,
      "deck-master-zone.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("deck master flagged true/153000001/true");
    expect(host.messages).toContain("deck master summon 1/4/true/153000001");
    expect(host.messages).toContain("deck master clear 1/true/false");
    expect(session.state.cards.find((card) => card.code === "153000001")).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "special" });
  });

  it("lets Lua scripts move cards into the deck master zone", () => {
    const cards: DuelCardData[] = [
      { code: "153000001", name: "Deck Master First", kind: "monster", attack: 1200, defense: 800 },
      { code: "153000002", name: "Deck Master Second", kind: "monster", attack: 1300, defense: 900 },
    ];
    const session = createDuel({ seed: 169, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["153000001", "153000002"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local first=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 153000001), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local second=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 153000002), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      first:MoveToDeckMasterZone(0)
      Debug.Message("deck master moved " .. tostring(first:IsDeckMaster()) .. "/" .. Duel.GetDeckMaster(0):GetCode() .. "/" .. first:GetLocation())
      second:MoveToDeckMasterZone(0)
      Debug.Message("deck master replaced " .. tostring(first:IsDeckMaster()) .. "/" .. tostring(second:IsDeckMaster()) .. "/" .. Duel.GetDeckMaster(0):GetCode())
      `,
      "deck-master-move-card.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("deck master moved true/153000001/1");
    expect(host.messages).toContain("deck master replaced false/true/153000002");
    expect(session.state.cards.find((card) => card.code === "153000001")).toMatchObject({ location: "deck" });
    expect(session.state.cards.find((card) => card.code === "153000002")).toMatchObject({ location: "deck" });
  });

  it("expires Lua flag effects at chain reset boundaries", () => {
    const cards: DuelCardData[] = [{ code: "101", name: "Flag Chain Source", kind: "monster" }];
    const session = createDuel({ seed: 137, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101"] },
      1: { main: ["101"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c101={}
      function c101.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("duel flag chain " .. Duel.RegisterFlagEffect(0, 911, RESET_CHAIN, 0, 1))
          Debug.Message("card flag chain " .. c:RegisterFlagEffect(912, RESET_CHAIN, 0, 1))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-chain-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("duel flag chain 1");
    expect(host.messages).toContain("card flag chain 1");
    expect(session.state.flagEffects).toHaveLength(0);
  });

  it("expires Lua flag effects at phase and card movement reset boundaries", () => {
    const cards: DuelCardData[] = [{ code: "102", name: "Flag Phase Source", kind: "monster" }];
    const session = createDuel({ seed: 138, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["102"] },
      1: { main: ["102"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "102");
    expect(source).toBeDefined();
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c102={}
      function c102.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("duel flag phase " .. Duel.RegisterFlagEffect(0, 921, RESET_PHASE + PHASE_BATTLE, 0, 1))
          Debug.Message("card flag field " .. c:RegisterFlagEffect(922, RESET_EVENT + RESET_TOFIELD, 0, 1))
          Debug.Message("card flag counted field " .. c:RegisterFlagEffect(923, RESET_EVENT + RESET_TOFIELD, 0, 2, 32))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-phase-move-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.flagEffects).toHaveLength(3);

    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    expect(session.state.flagEffects).toEqual([
      expect.objectContaining({ code: 921 }),
      expect.objectContaining({ code: 923, resetCount: 1, value: 32 }),
    ]);
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    expect(session.state.flagEffects.map((flag) => flag.code)).toEqual([921]);

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    applyAndAssert(session, battle!);

    expect(session.state.flagEffects).toHaveLength(0);
  });

  it("expires Lua card flag effects at turn-set reset boundaries", () => {
    const cards: DuelCardData[] = [{ code: "102", name: "Flag Turn Set Source", kind: "monster" }];
    const session = createDuel({ seed: 142, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["102"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "102");
    expect(source).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    source!.position = "faceUpAttack";
    source!.faceUp = true;
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      Debug.Message("card flag turn set " .. c:RegisterFlagEffect(924, RESET_EVENT + RESET_TURN_SET, 0, 1))
      Debug.Message("card flag counted turn set " .. c:RegisterFlagEffect(925, RESET_EVENT + RESET_TURN_SET, 0, 2, 42))
      Debug.Message("change turn set " .. Duel.ChangePosition(c, POS_FACEDOWN_DEFENSE))
      Debug.Message("card flag after " .. c:GetFlagEffect(924) .. "/" .. c:GetFlagEffect(925) .. "/" .. c:GetFlagEffectLabel(925))
      `,
      "flag-turn-set-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["card flag turn set 1", "card flag counted turn set 1", "change turn set 1", "card flag after 0/1/42"]);
    expect(session.state.flagEffects).toEqual([expect.objectContaining({ code: 925, resetCount: 1, value: 42 })]);
  });

  it("expires Lua card flag effects at monster/spell zone reset boundaries", () => {
    const cards: DuelCardData[] = [{ code: "102", name: "Flag Monster Spell Source", kind: "monster" }];
    const session = createDuel({ seed: 143, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["102"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "102");
    expect(source).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      Debug.Message("card flag mschange " .. c:RegisterFlagEffect(926, RESET_EVENT + RESET_MSCHANGE, 0, 1))
      Debug.Message("card flag counted mschange " .. c:RegisterFlagEffect(927, RESET_EVENT + RESET_MSCHANGE, 0, 2, 43))
      `,
      "flag-mschange-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    moveDuelCard(session.state, source!.uid, "spellTrapZone", 0);

    expect(session.state.flagEffects).toEqual([expect.objectContaining({ code: 927, resetCount: 1, value: 43 })]);
    expect(host.messages).toEqual(["card flag mschange 1", "card flag counted mschange 1"]);
  });

  it("counts Lua flag phase resets and reads sixth-argument labels", () => {
    const cards: DuelCardData[] = [{ code: "109", name: "Flag Count Source", kind: "monster" }];
    const session = createDuel({ seed: 146, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["109"] },
      1: { main: ["109"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c109={}
      function c109.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Duel.RegisterFlagEffect(0, 933, RESET_PHASE + PHASE_BATTLE + PHASE_MAIN2, 0, 2, 71)
          c:RegisterFlagEffect(934, RESET_PHASE + PHASE_BATTLE + PHASE_MAIN2, 0, 2, 81)
          c:RegisterFlagEffect(935, 0, EFFECT_FLAG_CLIENT_HINT, nil, 91)
          Debug.Message("duel counted label " .. Duel.GetFlagEffectLabel(0, 933))
          Debug.Message("card counted label " .. c:GetFlagEffectLabel(934))
          Debug.Message("nil count label " .. c:GetFlagEffectLabel(935))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-phase-reset-count.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(host.messages).toContain("duel counted label 71");
    expect(host.messages).toContain("card counted label 81");
    expect(host.messages).toContain("nil count label 91");

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    applyAndAssert(session, battle!);
    expect(session.state.flagEffects.filter((flag) => flag.code === 933 || flag.code === 934)).toEqual([
      expect.objectContaining({ code: 933, resetCount: 1, value: 71 }),
      expect.objectContaining({ code: 934, resetCount: 1, value: 81 }),
    ]);
    expect(restoreDuel(serializeDuel(session), createCardReader(cards)).state.flagEffects.filter((flag) => flag.code === 933 || flag.code === 934).map((flag) => flag.resetCount)).toEqual([1, 1]);

    const main2 = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "main2");
    expect(main2).toBeDefined();
    applyAndAssert(session, main2!);
    expect(session.state.flagEffects.map((flag) => flag.code)).toEqual([935]);
  });

  it("expires Lua flag phase resets only on matching opponent turns", () => {
    const cards: DuelCardData[] = [{ code: "110", name: "Flag Opponent Turn Source", kind: "monster" }];
    const session = createDuel({ seed: 147, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["110"] },
      1: { main: ["110"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c110={}
      function c110.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Duel.RegisterFlagEffect(0, 936, RESET_PHASE + PHASE_END + RESET_OPPO_TURN, 0, 1)
          c:RegisterFlagEffect(937, RESET_PHASE + PHASE_END + RESET_OPPO_TURN, 0, 1)
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-opponent-turn-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const playerEnd = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn");
    expect(playerEnd).toBeDefined();
    applyAndAssert(session, playerEnd!);
    expect(session.state.turnPlayer).toBe(1);
    expect(session.state.flagEffects.map((flag) => flag.code)).toEqual([936, 937]);

    const opponentEnd = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "endTurn");
    expect(opponentEnd).toBeDefined();
    applyAndAssert(session, opponentEnd!);

    expect(session.state.turnPlayer).toBe(0);
    expect(session.state.flagEffects).toHaveLength(0);
  });

  it("counts Lua flag phase resets only on matching self turns", () => {
    const cards: DuelCardData[] = [{ code: "111", name: "Flag Self Turn Source", kind: "monster" }];
    const session = createDuel({ seed: 148, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["111"] },
      1: { main: ["111"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c111={}
      function c111.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Duel.RegisterFlagEffect(0, 938, RESET_PHASE + PHASE_END + RESET_SELF_TURN, 0, 2, 72)
          c:RegisterFlagEffect(939, RESET_PHASE + PHASE_END + RESET_SELF_TURN, 0, 2, 82)
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-self-turn-reset-count.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn")!);
    expect(session.state.turnPlayer).toBe(1);
    expect(session.state.flagEffects.filter((flag) => flag.code === 938 || flag.code === 939)).toEqual([
      expect.objectContaining({ code: 938, resetCount: 1, value: 72 }),
      expect.objectContaining({ code: 939, resetCount: 1, value: 82 }),
    ]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.flagEffects.filter((flag) => flag.code === 938 || flag.code === 939)).toEqual([
      expect.objectContaining({ code: 938, resetCount: 1, value: 72 }),
      expect.objectContaining({ code: 939, resetCount: 1, value: 82 }),
    ]);

    const restoredOpponentEnd = getDuelLegalActions(restored, 1).find((candidate) => candidate.type === "endTurn");
    expect(getGroupedDuelLegalActions(restored, 1).flatMap((group) => group.actions)).toContainEqual(restoredOpponentEnd);
    applyAndAssert(restored, restoredOpponentEnd!);
    expect(restored.state.turnPlayer).toBe(0);
    expect(restored.state.flagEffects.filter((flag) => flag.code === 938 || flag.code === 939)).toEqual([
      expect.objectContaining({ code: 938, resetCount: 1, value: 72 }),
      expect.objectContaining({ code: 939, resetCount: 1, value: 82 }),
    ]);

    const restoredPlayerEnd = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "endTurn");
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toContainEqual(restoredPlayerEnd);
    applyAndAssert(restored, restoredPlayerEnd!);
    expect(restored.state.turnPlayer).toBe(1);
    expect(restored.state.flagEffects.filter((flag) => flag.code === 938 || flag.code === 939)).toEqual([]);
  });

  it("expires Lua flag effects at the Battle Start reset boundary", () => {
    const cards: DuelCardData[] = [{ code: "106", name: "Flag Battle Start Source", kind: "monster" }];
    const session = createDuel({ seed: 144, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["106"] },
      1: { main: ["106"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c106={}
      function c106.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("duel flag battle start " .. Duel.RegisterFlagEffect(0, 925, RESET_PHASE + PHASE_BATTLE_START, 0, 1))
          Debug.Message("card flag battle start " .. c:RegisterFlagEffect(926, RESET_PHASE + PHASE_BATTLE_START, 0, 1))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-battle-start-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.flagEffects.map((flag) => flag.code)).toEqual([925, 926]);

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    applyAndAssert(session, battle!);

    expect(session.state.flagEffects).toHaveLength(0);
  });

  it("expires Lua flag effects at the Battle Step reset boundary", () => {
    const cards: DuelCardData[] = [
      { code: "109", name: "Flag Battle Step Attacker", kind: "monster", attack: 1800 },
      { code: "110", name: "Flag Battle Step Source", kind: "monster" },
    ];
    const session = createDuel({ seed: 146, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["109", "110"] },
      1: { main: [] },
    });
    startDuel(session);
    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "109");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c110={}
      function c110.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Duel.RegisterFlagEffect(0, 929, RESET_PHASE + PHASE_BATTLE_STEP, 0, 1)
          c:RegisterFlagEffect(930, RESET_PHASE + PHASE_BATTLE_STEP, 0, 1)
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-battle-step-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.flagEffects.map((flag) => flag.code)).toEqual([929, 930]);

    enterFlagBattleStep(session, attacker!.uid);

    expect(session.state.battleWindow?.kind).toBe("attackNegationResponse");
    expect(session.state.flagEffects).toHaveLength(0);
  });

  it("expires Lua flag effects at Damage Step and Damage Calculation reset boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "107", name: "Flag Damage Attacker", kind: "monster", attack: 1800 },
      { code: "108", name: "Flag Damage Source", kind: "monster" },
    ];
    const session = createDuel({ seed: 145, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["107", "108"] },
      1: { main: [] },
    });
    startDuel(session);
    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "107");
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c108={}
      function c108.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Duel.RegisterFlagEffect(0, 927, RESET_PHASE + PHASE_DAMAGE, 0, 1)
          c:RegisterFlagEffect(928, RESET_PHASE + PHASE_DAMAGE_CAL, 0, 1)
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-damage-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.flagEffects.map((flag) => flag.code)).toEqual([927, 928]);

    enterFlagDamageStep(session, attacker!.uid);
    expect(session.state.flagEffects.map((flag) => flag.code)).toEqual([927, 928]);
    passFlagDamageWindow(session);
    passFlagDamageWindow(session);

    expect(session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(session.state.flagEffects.map((flag) => flag.code)).toEqual([927, 928]);
    passFlagDamageWindow(session);
    expect(session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(session.state.flagEffects.map((flag) => flag.code)).toEqual([927]);
    passFlagDamageWindow(session);
    expect(session.state.flagEffects.map((flag) => flag.code)).toEqual([927]);
    passFlagDamageWindow(session);
    expect(session.state.flagEffects).toHaveLength(0);
  });

  it("stacks flag effects and exposes the first flag label", () => {
    const cards: DuelCardData[] = [{ code: "103", name: "Flag Repeat Source", kind: "monster" }];
    const session = createDuel({ seed: 139, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["103"] },
      1: { main: ["103"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c103={}
      function c103.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("duel flag first " .. Duel.RegisterFlagEffect(0, 931, RESET_EVENT, 0, 1, 11))
          Debug.Message("duel flag second " .. Duel.RegisterFlagEffect(0, 931, RESET_EVENT, 0, 1, 12))
          Debug.Message("duel flag label " .. Duel.GetFlagEffectLabel(0, 931))
          Debug.Message("duel flag repeat " .. Duel.RegisterFlagEffect(0, 931, RESET_EVENT, EFFECT_FLAG_REPEAT, 1, 13))
          Debug.Message("duel flag repeat label " .. Duel.GetFlagEffectLabel(0, 931))
          Debug.Message("card flag first " .. c:RegisterFlagEffect(932, RESET_EVENT, 0, 1, 21))
          Debug.Message("card flag second " .. c:RegisterFlagEffect(932, RESET_EVENT, 0, 1, 22))
          Debug.Message("card flag label " .. c:GetFlagEffectLabel(932))
          Debug.Message("card flag repeat " .. c:RegisterFlagEffect(932, RESET_EVENT, EFFECT_FLAG_REPEAT, 1, 23))
          Debug.Message("card flag repeat label " .. c:GetFlagEffectLabel(932))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-repeat-labels.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toEqual(
      expect.arrayContaining([
        "duel flag first 1",
        "duel flag second 2",
        "duel flag label 11",
        "duel flag repeat 3",
        "duel flag repeat label 11",
        "card flag first 1",
        "card flag second 2",
        "card flag label 21",
        "card flag repeat 3",
        "card flag repeat label 21",
      ]),
    );
    expect(session.state.flagEffects.filter((flag) => flag.code === 931)).toHaveLength(3);
    expect(session.state.flagEffects.filter((flag) => flag.code === 932)).toHaveLength(3);
  });

  it("updates Lua flag effect labels", () => {
    const cards: DuelCardData[] = [{ code: "104", name: "Flag Label Source", kind: "monster" }];
    const session = createDuel({ seed: 140, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["104"] },
      1: { main: ["104"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c104={}
      function c104.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Duel.RegisterFlagEffect(0, 941, RESET_EVENT, 0, 1, 31)
          c:RegisterFlagEffect(942, RESET_EVENT, 0, 1, 41)
          Debug.Message("duel set label " .. Duel.SetFlagEffectLabel(0, 941, 32))
          Debug.Message("card set label " .. c:SetFlagEffectLabel(942, 42))
          Debug.Message("duel updated label " .. Duel.GetFlagEffectLabel(0, 941))
          Debug.Message("card updated label " .. c:GetFlagEffectLabel(942))
          Debug.Message("missing label " .. Duel.SetFlagEffectLabel(0, 999, 1) .. "/" .. c:SetFlagEffectLabel(999, 1))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-label-setters.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toEqual(
      expect.arrayContaining([
        "duel set label 1",
        "card set label 1",
        "duel updated label 32",
        "card updated label 42",
        "missing label 0/0",
      ]),
    );
  });

  it("uses the first repeated flag label and resets the whole repeated stack", () => {
    const cards: DuelCardData[] = [{ code: "105", name: "Flag Repeat Edge Source", kind: "monster" }];
    const session = createDuel({ seed: 141, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["105"] },
      1: { main: ["105"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c105={}
      function c105.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Duel.RegisterFlagEffect(0, 951, RESET_EVENT, EFFECT_FLAG_REPEAT, 1, 51)
          Duel.RegisterFlagEffect(0, 951, RESET_EVENT, EFFECT_FLAG_REPEAT, 1, 52)
          c:RegisterFlagEffect(952, RESET_EVENT, EFFECT_FLAG_REPEAT, 1, 61)
          c:RegisterFlagEffect(952, RESET_EVENT, EFFECT_FLAG_REPEAT, 1, 62)
          Debug.Message("duel repeated count " .. Duel.GetFlagEffect(0, 951))
          Debug.Message("card repeated count " .. c:GetFlagEffect(952))
          Debug.Message("duel repeated label " .. Duel.GetFlagEffectLabel(0, 951))
          Debug.Message("card repeated label " .. c:GetFlagEffectLabel(952))
          Debug.Message("duel repeated set " .. Duel.SetFlagEffectLabel(0, 951, 53))
          Debug.Message("card repeated set " .. c:SetFlagEffectLabel(952, 63))
          Debug.Message("duel repeated label after " .. Duel.GetFlagEffectLabel(0, 951))
          Debug.Message("card repeated label after " .. c:GetFlagEffectLabel(952))
          Debug.Message("duel repeated reset " .. Duel.ResetFlagEffect(0, 951))
          Debug.Message("card repeated reset " .. c:ResetFlagEffect(952))
          Debug.Message("duel repeated after " .. Duel.GetFlagEffect(0, 951))
          Debug.Message("card repeated after " .. c:GetFlagEffect(952))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-repeat-edge-labels.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(host.messages).toEqual(
      expect.arrayContaining([
        "duel repeated count 2",
        "card repeated count 2",
        "duel repeated label 51",
        "card repeated label 61",
        "duel repeated set 1",
        "card repeated set 1",
        "duel repeated label after 53",
        "card repeated label after 63",
        "duel repeated reset 2",
        "card repeated reset 2",
        "duel repeated after 0",
        "card repeated after 0",
      ]),
    );
    expect(session.state.flagEffects.filter((flag) => flag.code === 951 || flag.code === 952)).toHaveLength(0);
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

function passCurrentChain(session: ReturnType<typeof createDuel>): boolean {
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
  if (!pass) return false;
  applyAndAssert(session, pass);
  return true;
}

function enterFlagDamageStep(session: ReturnType<typeof createDuel>, attackerUid: string): void {
  enterFlagBattleStep(session, attackerUid);
  const defenderPass = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passAttack");
  expect(defenderPass).toBeDefined();
  applyAndAssert(session, defenderPass!);
  const attackerPass = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "passAttack");
  expect(attackerPass).toBeDefined();
  applyAndAssert(session, attackerPass!);
}

function enterFlagBattleStep(session: ReturnType<typeof createDuel>, attackerUid: string): void {
  const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
  expect(battle).toBeDefined();
  applyAndAssert(session, battle!);
  const attack = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attackerUid);
  expect(attack).toBeDefined();
  applyAndAssert(session, attack!);
}

function passFlagDamageWindow(session: ReturnType<typeof createDuel>): void {
  const firstPlayer = session.state.waitingFor ?? session.state.turnPlayer;
  const firstPass = getDuelLegalActions(session, firstPlayer).find((candidate) => candidate.type === "passDamage");
  expect(firstPass).toBeDefined();
  applyAndAssert(session, firstPass!);
  const secondPlayer = session.state.waitingFor ?? session.state.turnPlayer;
  const secondPass = getDuelLegalActions(session, secondPlayer).find((candidate) => candidate.type === "passDamage");
  expect(secondPass).toBeDefined();
  applyAndAssert(session, secondPass!);
}
