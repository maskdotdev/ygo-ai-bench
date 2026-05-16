import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

describe("duel snapshot card and effect shape validation", () => {
  it("rejects malformed card snapshots before restore", () => {
    const session = createDuel({ seed: 157, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badOwner = serializeDuel(session);
    const badOverlay = serializeDuel(session);
    badOwner.state.cards[0] = { ...badOwner.state.cards[0]!, owner: 2 as 0 };
    badOverlay.state.cards[0] = { ...badOverlay.state.cards[0]!, overlayUids: ["mat", 7 as unknown as string] };

    expect(() => restoreDuel(badOwner, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.owner must be a player id");
    expect(() => restoreDuel(badOverlay, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.overlayUids.1 must be a string");
  });

  it("rejects malformed card data snapshots before restore", () => {
    const session = createDuel({ seed: 158, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badKind = serializeDuel(session);
    const badSynchro = serializeDuel(session);
    badKind.state.cards[0] = { ...badKind.state.cards[0]!, data: { ...badKind.state.cards[0]!.data, kind: "token" as "monster" } };
    badSynchro.state.cards[0] = { ...badSynchro.state.cards[0]!, data: { ...badSynchro.state.cards[0]!.data, synchroMaterials: { tuner: "100", nonTuners: [7 as unknown as string] } } };

    expect(() => restoreDuel(badKind, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.data.kind must be a card kind");
    expect(() => restoreDuel(badSynchro, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.data.synchroMaterials.nonTuners.0 must be a string");
  });

  it("rejects malformed unique card state snapshots before restore", () => {
    const session = createDuel({ seed: 161, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badUnique = serializeDuel(session);
    badUnique.state.cards[0] = { ...badUnique.state.cards[0]!, uniqueOnField: { self: true, opponent: "no" as unknown as boolean, code: 100, locationMask: 0x04 } };

    expect(() => restoreDuel(badUnique, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.uniqueOnField.opponent must be a boolean");
  });

  it("rejects duplicate card uid snapshots before restore", () => {
    const session = createDuel({ seed: 162, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const duplicateUid = serializeDuel(session);
    duplicateUid.state.cards[1] = { ...duplicateUid.state.cards[1]!, uid: duplicateUid.state.cards[0]!.uid };

    expect(() => restoreDuel(duplicateUid, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.1.uid must be unique");
  });

  it("rejects broken overlay references before restore", () => {
    const session = createDuel({ seed: 163, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const missingOverlay = serializeDuel(session);
    const wrongLocation = serializeDuel(session);
    missingOverlay.state.cards[0] = { ...missingOverlay.state.cards[0]!, overlayUids: ["missing-material"] };
    wrongLocation.state.cards[0] = { ...wrongLocation.state.cards[0]!, overlayUids: [wrongLocation.state.cards[1]!.uid] };

    expect(() => restoreDuel(missingOverlay, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.overlayUids.0 must reference a card");
    expect(() => restoreDuel(wrongLocation, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.overlayUids.0 must reference an overlay card");
  });

  it("rejects broken card state references before restore", () => {
    const session = createDuel({ seed: 166, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badEquippedTo = serializeDuel(session);
    const badMaterial = serializeDuel(session);
    badEquippedTo.state.cards[0] = { ...badEquippedTo.state.cards[0]!, equippedToUid: "missing" };
    badMaterial.state.cards[0] = { ...badMaterial.state.cards[0]!, summonMaterialUids: [badMaterial.state.cards[1]!.uid, "missing"] };

    expect(() => restoreDuel(badEquippedTo, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.equippedToUid must reference a card");
    expect(() => restoreDuel(badMaterial, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.summonMaterialUids.1 must reference a card");
  });

  it("rejects unknown card and card data snapshot fields before restore", () => {
    const session = createDuel({ seed: 167, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const staleCard = serializeDuel(session);
    const staleData = serializeDuel(session);
    const staleUnique = serializeDuel(session);
    const staleSynchro = serializeDuel(session);
    staleCard.state.cards[0] = { ...staleCard.state.cards[0]!, staleWindow: "open" } as never;
    staleData.state.cards[0] = { ...staleData.state.cards[0]!, data: { ...staleData.state.cards[0]!.data, staleKind: "monster" } } as never;
    staleUnique.state.cards[0] = { ...staleUnique.state.cards[0]!, uniqueOnField: { self: true, opponent: false, code: 100, locationMask: 0x04, staleUnique: true } } as never;
    staleSynchro.state.cards[0] = { ...staleSynchro.state.cards[0]!, data: { ...staleSynchro.state.cards[0]!.data, synchroMaterials: { tuner: "100", nonTuners: ["400"], staleMaterial: true } } } as never;

    expect(() => restoreDuel(staleCard, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.staleWindow is not a known field");
    expect(() => restoreDuel(staleData, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.data.staleKind is not a known field");
    expect(() => restoreDuel(staleUnique, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.uniqueOnField.staleUnique is not a known field");
    expect(() => restoreDuel(staleSynchro, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.data.synchroMaterials.staleMaterial is not a known field");
  });

  it("rejects malformed effect snapshots before restore", () => {
    const session = createDuel({ seed: 159, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-shape-effect",
      registryKey: "snapshot-shape-effect",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation() {},
    });
    const badEvent = serializeDuel(session);
    const badRange = serializeDuel(session);
    const badTriggerEvent = serializeDuel(session);
    badEvent.state.effects[0] = { ...badEvent.state.effects[0]!, event: "passive" as "ignition" };
    badRange.state.effects[0] = { ...badRange.state.effects[0]!, range: ["hand", "field" as "hand"] };
    badTriggerEvent.state.effects[0] = { ...badTriggerEvent.state.effects[0]!, triggerEvent: "unknown" as "customEvent" };

    expect(() => restoreDuel(badEvent, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.event must be an effect event");
    expect(() => restoreDuel(badRange, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.range.1 must be a card location");
    expect(() => restoreDuel(badTriggerEvent, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.triggerEvent must be a duel event");
  });

  it("rejects duplicate effect identities before restore", () => {
    const session = createDuel({ seed: 169, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-duplicate-effect",
      registryKey: "snapshot-duplicate-effect",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation() {},
    });
    const duplicateEffect = serializeDuel(session);
    duplicateEffect.state.effects.push({ ...duplicateEffect.state.effects[0]! });

    expect(() => restoreDuel(duplicateEffect, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.1.id must be unique per source");
  });

  it("requires serialized trigger effects to pin trigger timing", () => {
    const session = createDuel({ seed: 170, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-default-trigger-timing",
      registryKey: "snapshot-default-trigger-timing",
      sourceUid: source!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation() {},
    });
    const snapshot = serializeDuel(session);
    expect(snapshot.state.effects[0]).toMatchObject({ triggerEvent: "normalSummoned", triggerTiming: "if" });
    const missingTriggerTiming = serializeDuel(session);
    delete missingTriggerTiming.state.effects[0]!.triggerTiming;

    expect(() => restoreDuel(missingTriggerTiming, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.triggerTiming is required when triggerEvent is set");
  });

  it("rejects unknown effect snapshot fields before restore", () => {
    const session = createDuel({ seed: 168, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-unknown-effect",
      registryKey: "snapshot-unknown-effect",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation() {},
    });
    const staleEffect = serializeDuel(session);
    staleEffect.state.effects[0] = { ...staleEffect.state.effects[0]!, staleSelector: true } as never;

    expect(() => restoreDuel(staleEffect, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.staleSelector is not a known field");
  });

  it("rejects malformed effect reset and tuple snapshots before restore", () => {
    const session = createDuel({ seed: 160, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-shape-reset-effect",
      registryKey: "snapshot-shape-reset-effect",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      range: ["hand"],
      reset: { flags: 1 },
      targetRange: [1],
      operation() {},
    });
    const badReset = serializeDuel(session);
    const badTuple = serializeDuel(session);
    const staleReset = serializeDuel(session);
    badReset.state.effects[0] = { ...badReset.state.effects[0]!, reset: { flags: "reset" as unknown as number } };
    badTuple.state.effects[0] = { ...badTuple.state.effects[0]!, targetRange: [1, 2, 3] as unknown as [number, number] };
    staleReset.state.effects[0] = { ...staleReset.state.effects[0]!, reset: { flags: 1, staleReset: true } } as never;

    expect(() => restoreDuel(badReset, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.reset.flags must be a number");
    expect(() => restoreDuel(badTuple, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.targetRange must contain one or two numbers");
    expect(() => restoreDuel(staleReset, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.reset.staleReset is not a known field");
  });
});
